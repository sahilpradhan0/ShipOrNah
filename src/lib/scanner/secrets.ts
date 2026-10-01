import { shannonEntropy } from "@/lib/utils/entropy";
import type { ScanFile, SecretFinding } from "./types";

const SCANNABLE_EXTENSIONS = /\.(js|ts|tsx|jsx|json|env(\..+)?)$/i;
const SKIP_FILE_PATTERN = /\.env\.(example|sample)$/i;

const PLACEHOLDER_COMMENT_PATTERN =
  /\b(example|placeholder|your-key-here|replace-me|changeme|xxx+|todo|sample|dummy|fake|test-key)\b/i;

type SecretSeverity = "critical" | "high" | "medium";

interface Resolution {
  service: string;
  title: string;
  description: string;
  severity: SecretSeverity;
  /** Overrides the generic "rotate and move to an env var" advice. */
  fix?: string;
}

interface NamedPattern {
  regex: RegExp;
  services: string[];
  /** `ambiguous` is true when several services share this key format and the file gave no clue. */
  build: (service: string, ambiguous: boolean) => Resolution;
  /** Optional: overrides `build` using the surrounding line/file (used for Google keys). */
  resolve?: (ctx: { line: string; content: string; secretValue: string }) => Resolution;
}

/** Pulls the variable/property name assigned on this line, e.g. GEMINI_API_KEY. */
function extractVariableName(line: string, secretValue: string): string | null {
  const idx = line.indexOf(secretValue);
  const before = idx === -1 ? line : line.slice(0, idx);
  const m = before.match(/([A-Za-z_$][\w$.-]*)["'`]?\s*[:=]\s*[^:=]*$/);
  return m ? m[1] : null;
}

function resolveGoogleKey(ctx: { line: string; content: string; secretValue: string }): Resolution {
  const name = extractVariableName(ctx.line, ctx.secretValue) ?? "";
  // Name on the line is the strongest signal, file-level imports/URLs are second.
  const detect = (text: string): "Gemini" | "Firebase" | "Google Maps" | null => {
    if (/gemini|generative[-_]?(ai|language)|generativelanguage/i.test(text)) return "Gemini";
    if (/firebase/i.test(text)) return "Firebase";
    if (/maps|places|geocod/i.test(text)) return "Google Maps";
    return null;
  };
  const kind = detect(name) ?? detect(ctx.line) ?? detect(ctx.content);

  switch (kind) {
    case "Gemini":
      return {
        service: "Gemini",
        title: "Exposed Gemini API key",
        severity: "critical",
        description:
          "Anyone who finds this key can call the Gemini API and run up charges on your Google Cloud project.",
      };
    case "Firebase":
      return {
        service: "Firebase",
        title: "Exposed Firebase API key",
        severity: "medium",
        description:
          "Firebase web API keys are designed to be public, but only if your Firebase Security Rules are locked down and the key is restricted to your domains.",
        fix: "Restrict the key to your domains (Google Cloud Console > APIs & Services > Credentials > Application restrictions) and review your Firestore/Storage Security Rules. Rotate it only if it is unrestricted.",
      };
    case "Google Maps":
      return {
        service: "Google Maps",
        title: "Exposed Google Maps API key",
        severity: "medium",
        description:
          "Maps keys are visible in the browser by design. Make sure this one is restricted to your domains and to the Maps APIs you use, or others can use it on your bill.",
        fix: "Restrict the key by HTTP referrer and by API (Google Cloud Console > APIs & Services > Credentials). Rotate it if it was created without restrictions.",
      };
    default:
      return {
        service: "Google",
        title: "Exposed Google API key",
        severity: "critical",
        description:
          "Google API keys can access any Google Cloud API enabled on the project (including Gemini). Restrict or rotate it.",
      };
  }
}

const NAMED_PATTERNS: NamedPattern[] = [
  {
    regex: /(?<![A-Za-z0-9_-])sk-proj-[a-zA-Z0-9_-]{16,}/g,
    services: ["OpenAI"],
    build: (s) => ({
      service: s,
      title: "Exposed OpenAI project API key",
      severity: "critical",
      description:
        "Anyone with this key can call OpenAI as your project and run up usage charges. Revoke it in the OpenAI dashboard and create a new one.",
    }),
  },
  {
    regex: /(?<![A-Za-z0-9_-])sk-admin-[a-zA-Z0-9_-]{16,}/g,
    services: ["OpenAI"],
    build: (s) => ({
      service: s,
      title: "Exposed OpenAI admin API key",
      severity: "critical",
      description:
        "Admin keys manage your whole organization: they can create and delete API keys, change projects and members, and read usage data. Treat this as a full account compromise.",
    }),
  },
  {
    regex: /(?<![A-Za-z0-9_-])sk-ant-[a-zA-Z0-9_-]{16,}/g,
    services: ["Anthropic"],
    build: (s) => ({
      service: s,
      title: "Exposed Anthropic API key",
      severity: "critical",
      description:
        "Anyone with this key can send requests to the Anthropic API and run up charges on your account.",
    }),
  },
  {
    // `sk_live_` is used by both Stripe and Clerk, so this one needs disambiguation.
    regex: /(?<![A-Za-z0-9_-])sk_live_[0-9a-zA-Z]{24}/g,
    services: ["Stripe", "Clerk"],
    build: (s, ambiguous) => {
      if (ambiguous) {
        return {
          service: s,
          title: "Possible exposed live secret key (Stripe or Clerk)",
          severity: "critical",
          description:
            "This looks like a live secret key (sk_live_...). Both Stripe and Clerk use that format and nothing in this file says which one it is. Either way it gives full server-side access to your account.",
          fix: "Work out which service issued the key, roll it in that dashboard, then remove it from source code and load it from an environment variable or secrets manager.",
        };
      }
      if (s === "Clerk") {
        return {
          service: s,
          title: "Exposed Clerk live secret key",
          severity: "critical",
          description:
            "A live Clerk secret key lets anyone act as your backend: read and modify users, sessions and organizations.",
        };
      }
      return {
        service: s,
        title: "Exposed Stripe live secret key",
        severity: "critical",
        description:
          "A live secret key gives full API access to your Stripe account: attackers can read customer data, issue refunds and create charges.",
      };
    },
  },
  {
    regex: /(?<![A-Za-z0-9_-])rk_live_[0-9a-zA-Z]{24}/g,
    services: ["Stripe"],
    build: (s) => ({
      service: s,
      title: "Exposed Stripe restricted live key",
      severity: "critical",
      description:
        "Restricted keys are limited to the permissions you granted, but those can still expose customer data or move money. Check what this key is allowed to do in the Stripe dashboard.",
    }),
  },
  {
    regex: /(?<![A-Za-z0-9_-])sbp_[a-zA-Z0-9]{16,}/g,
    services: ["Supabase"],
    build: (s) => ({
      service: s,
      title: "Exposed Supabase personal access token",
      severity: "critical",
      description:
        "A personal access token acts as you in the Supabase Management API: it can read and change every project in your account, including database settings and API keys.",
    }),
  },
  {
    regex: /(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}/g,
    services: ["AWS"],
    build: (s) => ({
      service: s,
      title: "Exposed AWS access key ID",
      severity: "high",
      description:
        "An access key ID identifies an IAM user and is normally paired with a secret access key. The ID alone can't sign requests, but if the secret is anywhere in this repo the account is compromised. Search for it and rotate both.",
      fix: "Deactivate this key in IAM (Security credentials > Access keys), create a new one, and load it from an environment variable or secrets manager. Check CloudTrail for activity from the old key.",
    }),
  },
  {
    // One `AIza...` key format is shared by Gemini, Firebase, Maps and every
    // other Google Cloud API, so the pattern alone can't tell them apart.
    // resolveGoogleKey() uses the variable name and imports to pick a label.
    regex: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g,
    services: ["Google"],
    build: (s) => ({
      service: s,
      title: "Exposed Google API key",
      severity: "critical",
      description: "Restrict or rotate this Google API key.",
    }),
    resolve: resolveGoogleKey,
  },
  {
    // Real Resend keys are `re_` + ~37 random alphanumeric characters. The
    // negative lookbehind stops this from matching "re_" as a coincidental
    // substring inside ordinary identifiers like `restore_version` or
    // `ai_feature_used` — it only matches when "re_" actually starts a token
    // (preceded by nothing, or by a quote/operator/whitespace, not a letter).
    regex: /(?<![A-Za-z0-9_-])re_[a-zA-Z0-9]{20,}/g,
    services: ["Resend"],
    build: (s) => ({
      service: s,
      title: "Exposed Resend API key",
      severity: "critical",
      description:
        "Anyone with this key can send email from your verified domains, which enables phishing and spam and damages your sender reputation.",
    }),
  },
  {
    regex: /(?<![A-Za-z0-9_-])SK[a-z0-9]{32}/g,
    services: ["Twilio"],
    build: (s) => ({
      service: s,
      title: "Exposed Twilio API key SID",
      severity: "high",
      description:
        "Twilio API keys are a SID (SK...) plus a separate secret. The SID alone can't authenticate, but if the secret is exposed too, anyone can send SMS and place calls on your account. Look for the secret nearby and revoke the key.",
      fix: "Delete this API key in the Twilio Console (Account > API keys & tokens) and create a new one. Load both parts from environment variables.",
    }),
  },
  {
    regex: /(?<![A-Za-z0-9_-])AC[a-z0-9]{32}/g,
    services: ["Twilio"],
    build: (s) => ({
      service: s,
      title: "Exposed Twilio account SID",
      severity: "medium",
      description:
        "An account SID is an identifier, not a credential. It becomes a problem only alongside your auth token, so make sure the token isn't committed anywhere.",
      fix: "No rotation needed for the SID itself. Confirm your Twilio auth token and API key secrets are stored in environment variables and not in this repo.",
    }),
  },
];

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

const SERVICE_HINTS: Record<string, RegExp[]> = {
  OpenAI: [/openai/i, /@ai-sdk\/openai/i, /gpt-/i],
  Anthropic: [/anthropic/i, /@ai-sdk\/anthropic/i, /claude/i],
  Stripe: [/stripe/i, /@stripe\//i],
  Clerk: [/clerk/i, /@clerk\//i],
  Supabase: [/supabase/i, /@supabase\//i],
  AWS: [/\baws-sdk\b/i, /@aws-sdk\//i, /amazonaws/i],
  "Google/Gemini/Firebase": [/firebase/i, /googleapis/i, /@google-cloud\//i, /gemini/i, /@google\/generative-ai/i],
  Resend: [/resend/i, /@react-email\//i],
  Twilio: [/twilio/i],
};

function isScannableFile(filePath: string): boolean {
  if (SKIP_FILE_PATTERN.test(filePath)) return false;
  return SCANNABLE_EXTENSIONS.test(filePath) || filePath.endsWith(".env");
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function getLineContent(content: string, lineNumber: number): string {
  return content.split("\n")[lineNumber - 1] ?? "";
}

function isInsideComment(content: string, matchIndex: number): boolean {
  const lineNumber = getLineNumber(content, matchIndex);
  const line = getLineContent(content, lineNumber);

  const lineStart = content.lastIndexOf("\n", matchIndex - 1) + 1;
  const beforeMatch = content.slice(lineStart, matchIndex);

  // `(?<!:)` so the "//" in a URL like https://api.foo.com is not mistaken for a comment.
  if (/(?<!:)\/\/.*$/.test(beforeMatch) || /^\s*\/\//.test(line)) {
    return true;
  }

  if (/#.*$/.test(beforeMatch) && /\.env/i.test(line)) {
    return true;
  }

  const blockCommentStart = content.lastIndexOf("/*", matchIndex);
  if (blockCommentStart !== -1) {
    const blockCommentEnd = content.indexOf("*/", blockCommentStart);
    if (blockCommentEnd === -1 || blockCommentEnd > matchIndex) {
      return true;
    }
  }

  return false;
}

function isPlaceholderContext(content: string, matchIndex: number, secretValue: string): boolean {
  const lineNumber = getLineNumber(content, matchIndex);
  const line = getLineContent(content, lineNumber);
  const previousLine = lineNumber > 1 ? getLineContent(content, lineNumber - 1) : "";

  if (PLACEHOLDER_COMMENT_PATTERN.test(line)) return true;
  if (PLACEHOLDER_COMMENT_PATTERN.test(secretValue)) return true;

  if (
    /^\s*(\/\/|\/\*|#)/.test(previousLine) &&
    PLACEHOLDER_COMMENT_PATTERN.test(previousLine)
  ) {
    return true;
  }

  const contextStart = Math.max(0, matchIndex - 120);
  const contextEnd = Math.min(content.length, matchIndex + secretValue.length + 120);
  const surrounding = content.slice(contextStart, contextEnd);

  if (isInsideComment(content, matchIndex) && PLACEHOLDER_COMMENT_PATTERN.test(surrounding)) {
    return true;
  }

  const lowEntropyPlaceholders = [
    "your-key-here",
    "your_api_key",
    "insert-key",
    "sk-xxx",
    "pk_test_xxx",
    "sk_test_xxx",
  ];
  if (lowEntropyPlaceholders.some((p) => secretValue.toLowerCase().includes(p))) {
    return true;
  }

  return false;
}

export function redactSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

const SNIPPET_MAX_LENGTH = 100;
const SNIPPET_CONTEXT = 40;

/**
 * Shows the whole (redacted) line when it's short. For long lines it keeps a
 * window around the secret and snaps both edges to word boundaries, so the
 * preview never starts or ends mid-word.
 */
function buildSnippetPreview(line: string, secretValue: string): string {
  const redacted = redactSecret(secretValue);
  const idx = line.indexOf(secretValue);

  const full = idx === -1 ? line : line.replace(secretValue, () => redacted);
  const trimmedStart = full.trimStart();
  const offset = full.length - trimmedStart.length;
  const text = trimmedStart.trimEnd();

  if (text.length <= SNIPPET_MAX_LENGTH) return text;
  if (idx === -1) return `${text.slice(0, SNIPPET_MAX_LENGTH - 1)}\u2026`;

  const at = Math.max(0, idx - offset);
  const secretEnd = at + redacted.length;
  let start = Math.max(0, at - SNIPPET_CONTEXT);
  let end = Math.min(text.length, secretEnd + SNIPPET_CONTEXT);

  if (start > 0) {
    const m = text.slice(start, at).search(/[\s,;({[]/);
    if (m !== -1) start += m + 1;
  }
  if (end < text.length) {
    const tail = text.slice(secretEnd, end);
    const lastBoundary = Math.max(tail.lastIndexOf(" "), tail.lastIndexOf(","), tail.lastIndexOf(";"));
    if (lastBoundary !== -1) end = secretEnd + lastBoundary + 1;
  }

  return `${start > 0 ? "\u2026" : ""}${text.slice(start, end).trim()}${end < text.length ? "\u2026" : ""}`;
}

function disambiguateService(
  services: string[],
  fileContent: string,
): { service: string; ambiguous: boolean } {
  if (services.length === 1) return { service: services[0], ambiguous: false };

  const scores = new Map<string, number>();
  for (const service of services) {
    scores.set(service, 0);
    const hints = SERVICE_HINTS[service] ?? [];
    for (const hint of hints) {
      if (hint.test(fileContent)) {
        scores.set(service, (scores.get(service) ?? 0) + 1);
      }
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topService, topScore] = ranked[0];
  const [, secondScore] = ranked[1] ?? [, 0];

  if (topScore > 0 && topScore > (secondScore ?? 0)) {
    return { service: topService, ambiguous: false };
  }

  return { service: services.join(" or "), ambiguous: true };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isSupabaseServiceRoleJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  return payload.role === "service_role";
}

function getFixSuggestion(filePath: string, custom?: string): string {
  const isEnvFile = filePath.endsWith(".env") || filePath.includes(".env.");
  if (isEnvFile) {
    return custom
      ? `${custom} Also remove this environment file from your Git history and add it to .gitignore.`
      : "You committed an environment file containing a secret. Rotate the credential immediately, remove the file from your Git history, and ensure it is added to your .gitignore.";
  }
  return (
    custom ??
    "Rotate this credential immediately, remove it from source code, and store it securely in an environment variable or secrets manager."
  );
}

function makeFinding(
  filePath: string,
  content: string,
  matchIndex: number,
  secretValue: string,
  resolution: Resolution,
): SecretFinding {
  const lineNumber = getLineNumber(content, matchIndex);
  const line = getLineContent(content, lineNumber);

  return {
    type: "secret",
    severity: resolution.severity,
    service: resolution.service,
    title: resolution.title,
    filePath,
    lineNumber,
    snippetPreview: buildSnippetPreview(line, secretValue),
    description: resolution.description,
    fixSuggestion: getFixSuggestion(filePath, resolution.fix),
  };
}

interface RawMatch {
  filePath: string;
  content: string;
  matchIndex: number;
  secretValue: string;
  resolution: Resolution;
}

function collectNamedPatternMatches(file: ScanFile): RawMatch[] {
  const matches: RawMatch[] = [];

  for (const pattern of NAMED_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(file.content)) !== null) {
      const secretValue = match[0];
      const matchIndex = match.index;

      if (isInsideComment(file.content, matchIndex)) continue;
      if (isPlaceholderContext(file.content, matchIndex, secretValue)) continue;

      let resolution: Resolution;
      if (pattern.resolve) {
        const line = getLineContent(file.content, getLineNumber(file.content, matchIndex));
        resolution = pattern.resolve({ line, content: file.content, secretValue });
      } else {
        const { service, ambiguous } = disambiguateService(pattern.services, file.content);
        resolution = pattern.build(service, ambiguous);
      }

      matches.push({ filePath: file.path, content: file.content, matchIndex, secretValue, resolution });
    }
  }

  return matches;
}

function collectJwtMatches(file: ScanFile): RawMatch[] {
  const matches: RawMatch[] = [];
  JWT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = JWT_PATTERN.exec(file.content)) !== null) {
    const secretValue = match[0];
    const matchIndex = match.index;

    if (!isSupabaseServiceRoleJwt(secretValue)) continue;
    if (isInsideComment(file.content, matchIndex)) continue;
    if (isPlaceholderContext(file.content, matchIndex, secretValue)) continue;

    matches.push({
      filePath: file.path,
      content: file.content,
      matchIndex,
      secretValue,
      resolution: {
        service: "Supabase",
        title: "Exposed Supabase service role key",
        severity: "critical",
        description:
          "The service role key bypasses Row Level Security, so anyone holding it has unrestricted read and write access to your entire database.",
      },
    });
  }

  return matches;
}

function dedupeMatches(matches: RawMatch[]): RawMatch[] {
  const seen = new Set<string>();
  const unique: RawMatch[] = [];

  for (const m of matches) {
    const key = `${m.filePath}:${getLineNumber(m.content, m.matchIndex)}:${m.secretValue.slice(0, 8)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(m);
  }

  return unique;
}

/**
 * Scan file contents for leaked secrets and API keys using three detection layers:
 * 1. Named provider-specific patterns
 * 2. Generic high-entropy secret assignments
 * 3. Context-based service disambiguation
 */
export function scanSecrets(files: ScanFile[]): SecretFinding[] {
  const allMatches: RawMatch[] = [];

  for (const file of files) {
    if (!isScannableFile(file.path)) continue;

    allMatches.push(
      ...collectNamedPatternMatches(file),
      ...collectJwtMatches(file),
    );
  }

  return dedupeMatches(allMatches).map((m) =>
    makeFinding(m.filePath, m.content, m.matchIndex, m.secretValue, m.resolution),
  );
}
