import type { ExposedFileFinding } from "./types";
import { redactSecret } from "./secrets";

const FETCH_TIMEOUT_MS = 5000;
const MAX_PREVIEW_LINES = 5;

// Paths that should never be publicly reachable on a deployed app. Checked
// read-only via plain GET — never anything that could mutate state.
const SENSITIVE_PATHS = [
  { path: "/.env", kind: "env" as const },
  { path: "/.env.local", kind: "env" as const },
  { path: "/.git/config", kind: "git" as const },
];

async function safeFetch(url: string): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": "ShipOrNah-Scanner" },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res;
  } catch {
    return null;
  }
}

function looksLikeRealEnvFile(body: string): boolean {
  if (/<html/i.test(body)) return false; // almost certainly a 404/catch-all page
  // Real .env files are lines of KEY=value; require at least one plausible match.
  return /^[A-Z0-9_]+\s*=\s*\S+/m.test(body.trim());
}

function looksLikeRealGitConfig(body: string): boolean {
  if (/<html/i.test(body)) return false;
  return /\[core\]/i.test(body);
}

function redactEnvBody(body: string): string {
  const lines = body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, MAX_PREVIEW_LINES);

  return lines
    .map((line) => {
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) return line;
      const key = line.slice(0, eqIdx);
      const value = line.slice(eqIdx + 1).trim();
      if (value.length === 0) return line;
      return `${key}=${redactSecret(value)}`;
    })
    .join("\n");
}

/**
 * Check whether sensitive files (.env, .git/config) are publicly reachable
 * on the deployed app. Read-only GET requests only — never anything that
 * writes or authenticates.
 */
export async function checkExposedFiles(baseUrl: string): Promise<ExposedFileFinding[]> {
  const findings: ExposedFileFinding[] = [];
  const base = baseUrl.replace(/\/+$/, "");

  for (const { path, kind } of SENSITIVE_PATHS) {
    const fileUrl = `${base}${path}`;
    const res = await safeFetch(fileUrl);
    if (!res || !res.ok) continue;

    const body = await res.text();
    const isReal = kind === "env" ? looksLikeRealEnvFile(body) : looksLikeRealGitConfig(body);
    if (!isReal) continue;

    const preview = kind === "env" ? redactEnvBody(body) : body.slice(0, 300);

    findings.push({
      type: "exposed_file",
      severity: "critical",
      fileUrl,
      description:
        kind === "env"
          ? `${path} is publicly accessible and contains what looks like real environment variables:\n\n${preview}`
          : `${path} is publicly accessible, exposing repository metadata (and potentially commit history/remote URLs).`,
      fixSuggestion:
        kind === "env"
          ? `Remove ${path} from your deployed build output. Add it to .gitignore, and ensure your hosting platform's build step doesn't copy dotfiles into the public/static directory. Rotate any credentials that were exposed.`
          : `Ensure your .git directory is never included in the deployed build output — most frameworks exclude this by default, so check your static file serving configuration and hosting platform settings.`,
    });
  }

  return findings;
}

/**
 * Check whether production JS bundles have publicly accessible source maps,
 * which expose fully unminified source (including comments, and sometimes
 * hardcoded values developers assumed were hidden by minification).
 */
export async function checkSourceMaps(
  baseUrl: string,
  scriptUrls: string[],
): Promise<ExposedFileFinding[]> {
  const findings: ExposedFileFinding[] = [];
  const checked = new Set<string>();

  for (const scriptUrl of scriptUrls) {
    if (!scriptUrl.endsWith(".js")) continue;
    const mapUrl = `${scriptUrl}.map`;
    if (checked.has(mapUrl)) continue;
    checked.add(mapUrl);

    const res = await safeFetch(mapUrl);
    if (!res || !res.ok) continue;

    try {
      const json = (await res.json()) as { sources?: unknown; version?: unknown };
      if (!Array.isArray(json.sources) || json.sources.length === 0) continue;

      findings.push({
        type: "exposed_file",
        severity: "critical",
        fileUrl: mapUrl,
        description: `A source map is publicly accessible at this URL, exposing fully unminified source code for ${scriptUrl.split("/").pop()} — including original file structure, variable names, and comments.`,
        fixSuggestion:
          "Disable source map generation for production builds, or ensure .map files are excluded from your deployed output. In Next.js: set `productionBrowserSourceMaps: false` in next.config.js (this is the default, so check if something explicitly enabled it).",
      });
    } catch {
      continue;
    }
  }

  return findings;
}
