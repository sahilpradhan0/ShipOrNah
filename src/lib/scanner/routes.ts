import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type { Node } from "@babel/types";
import type { ScanFile, UnprotectedRouteFinding } from "./types";

const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;

const ROUTE_FILE_PATTERN =
  /(?:^|\/)(?:app\/api\/.*\/route\.(ts|js)|pages\/api\/.*\.(ts|js))$/;

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// Calls that check who the caller is.
const AUTH_CALL_PATTERNS = [
  /supabase\.auth\.getUser\s*\(/,
  /\bauth\s*\(\s*\)/,
  /\bgetServerSession\s*\(/,
  /\brequireAuth\s*\(/,
  /\bgetUser\s*\(\s*\)/,
  /\b(?:currentUser|requireUser|getCurrentUser|getToken|validateRequest)\s*\(/,
  /\b(?:jwtVerify|verifyToken|verifyJwt|verifyJWT)\s*\(/,
  /\bjwt\.verify\s*\(/,
  // Reading an incoming credential header, or a shared secret (cron jobs, internal calls).
  /\.get\(\s*["'](?:authorization|x-api-key)["']\s*\)/i,
  /\bCRON_SECRET\b/,
];

// Webhooks can't have a signed-in user. They prove the caller by checking a signature instead.
const SIGNATURE_CHECK_PATTERNS = [
  /\bconstructEvent(?:Async)?\s*\(/,
  /\bnew\s+Webhook\s*\(/,
  /\bverifyWebhook\w*\s*\(/,
  /\bverifySignature\w*\s*\(/,
  /\bnew\s+Receiver\s*\(/,
  /\btimingSafeEqual\s*\(/,
  /\bcreateHmac\s*\(/,
  /["'](?:stripe-signature|x-hub-signature(?:-256)?|x-slack-signature)["']/i,
];

// Routes that have to be public for sign-in to work at all.
const PUBLIC_ROUTE_NAMES =
  /^(?:login|log-in|signin|sign-in|signup|sign-up|register|logout|log-out|signout|sign-out|callback|forgot-password|reset-password|verify-email|csrf)$/i;
const AUTH_LIBRARY_HANDLER = /\b(?:NextAuth|toNextJsHandler)\s*\(/;

function isRouteFile(path: string): boolean {
  return ROUTE_FILE_PATTERN.test(path.replace(/\\/g, "/"));
}

function getHandlerMethod(name: string): string | null {
  const upper = name.toUpperCase();
  return MUTATING_METHODS.has(upper) ? upper : null;
}

function isAuthCallSource(source: string): boolean {
  if (AUTH_CALL_PATTERNS.some((p) => p.test(source))) return true;
  if (SIGNATURE_CHECK_PATTERNS.some((p) => p.test(source))) return true;
  return /\b\w*(auth|session)\w*\s*\(/i.test(source);
}

/** Sign-in, sign-up and auth-library routes are public by design, so they're not worth flagging. */
function isPublicByDesign(file: ScanFile): boolean {
  if (AUTH_LIBRARY_HANDLER.test(file.content)) return true;

  const segments = file.path
    .replace(/\\/g, "/")
    .replace(/\.(?:ts|js)$/, "")
    .split("/");
  const afterApi = segments.slice(segments.lastIndexOf("api") + 1);

  if (afterApi.some((segment) => PUBLIC_ROUTE_NAMES.test(segment))) return true;
  // Catch-all handlers under /api/auth/ (e.g. [...nextauth], [...all]).
  return afterApi[0] === "auth" && afterApi.some((segment) => segment.startsWith("[..."));
}

// ---------------------------------------------------------------------------
// Does the handler touch anything worth protecting?
// ---------------------------------------------------------------------------
//
// An open endpoint is only a problem if it does something: changes data, or calls a
// service that costs money or sends messages. Handlers that do neither (a contact form
// that just returns JSON, a calculator) are skipped to keep the report trustworthy.

interface Touch {
  data: boolean;
  service: boolean;
}

// Calls that read or write a database, storage or the file system.
const DATA_CALL_PATTERNS = [
  /(?<!\bArray|\bBuffer|\bObject)\.from\s*\(/, // supabase.from("x") but not Array.from(...)
  /\.rpc\s*\(/,
  /\.storage\b/,
  /\bprisma\b/i,
  /\bsupabase\w*\b/i,
  /\bdb\s*[.[]/,
  /\.(?:collection|doc)\s*\(/,
  /\bsql\s*`/,
  /\.query\s*\(/,
  /\$(?:queryRaw|executeRaw)/,
  /\.(?:insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|findOneAndUpdate|findByIdAndUpdate|findByIdAndDelete|bulkWrite)\s*\(/,
  /\.save\s*\(/,
  /\bfs\.(?:promises\.)?(?:writeFile|appendFile|unlink|rm|rename)\w*\s*\(/,
];

// Calls to services that cost money, send messages or move money.
const SERVICE_CALL_PATTERNS = [
  /api\.(?:openai|anthropic|resend|stripe|sendgrid|twilio)\.com/,
  /generativelanguage\.googleapis\.com/,
];

const DATA_PACKAGES =
  /^(?:@supabase\/|@prisma\/|prisma$|drizzle-orm|mongoose$|mongodb$|firebase|@firebase\/|pg$|postgres$|mysql2?$|@neondatabase\/|@vercel\/(?:postgres|kv|blob)|@upstash\/|@libsql\/|better-sqlite3$|knex$|typeorm$|sequelize$|@planetscale\/|ioredis$|redis$|@aws-sdk\/client-(?:s3|dynamodb)|convex|@sanity\/|airtable$|@notionhq\/)/;
const SERVICE_PACKAGES =
  /^(?:openai$|@anthropic-ai\/|@google\/(?:generative-ai|genai)|ai$|@ai-sdk\/|stripe$|resend$|nodemailer$|@sendgrid\/|twilio$|@aws-sdk\/client-ses|replicate$|groq-sdk$|cohere-ai$|@mistralai\/|@langchain\/)/;
// Local files such as "@/lib/db" or "../lib/openai" are classified by name.
const LOCAL_DATA_MODULE =
  /(?:^|\/)(?:db|database|prisma|supabase|drizzle|firebase|mongo|queries|repositor(?:y|ies)|models?|orm|schema)(?:\/|$|\.)/i;
const LOCAL_SERVICE_MODULE =
  /(?:^|\/)(?:openai|anthropic|gemini|stripe|resend|email|mailer|twilio|sms|llm)(?:\/|$|\.)/i;

const IMPORT_PATTERN = /import\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;

/** The local names an import clause brings in: `X`, `{ a, b as c }`, `* as ns`. */
function parseImportNames(clause: string): string[] {
  const names: string[] = [];
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const cleaned = part.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      const pieces = cleaned.split(/\s+as\s+/);
      names.push((pieces[1] ?? pieces[0]).trim());
    }
  }
  const rest = clause.replace(/\{[^}]*\}/, "").trim();
  const namespace = rest.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) names.push(namespace[1]);
  const defaultName = rest.match(/^([A-Za-z_$][\w$]*)/);
  if (defaultName) names.push(defaultName[1]);
  return names;
}

interface ImportedBindings {
  data: string[];
  service: string[];
}

function collectImportedBindings(content: string): ImportedBindings {
  const result: ImportedBindings = { data: [], service: [] };
  IMPORT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    const [, clause, moduleName] = match;
    const isLocal = /^(?:\.|@\/|~\/)/.test(moduleName);
    const names = parseImportNames(clause);
    if (DATA_PACKAGES.test(moduleName) || (isLocal && LOCAL_DATA_MODULE.test(moduleName))) {
      result.data.push(...names);
    } else if (SERVICE_PACKAGES.test(moduleName) || (isLocal && LOCAL_SERVICE_MODULE.test(moduleName))) {
      result.service.push(...names);
    }
  }

  // `const resend = new Resend(...)` or `const supabase = createClient(...)`: the variable is
  // what the handler actually uses, so treat it as coming from the same module.
  for (const kind of ["data", "service"] as const) {
    for (const name of [...result[kind]]) {
      const escaped = name.replace(/[$]/g, "\\$");
      const assignment = new RegExp(
        `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*(?:await\\s+)?(?:new\\s+)?${escaped}(?![\\w$])`,
        "g",
      );
      let match: RegExpExecArray | null;
      while ((match = assignment.exec(content)) !== null) result[kind].push(match[1]);
    }
  }
  return result;
}

function usesAny(source: string, names: string[]): boolean {
  return names.some((name) =>
    new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`).test(source),
  );
}

/** What, if anything, does this code touch? `source` must not include import lines. */
function detectTouch(source: string, bindings: ImportedBindings): Touch | null {
  const data = DATA_CALL_PATTERNS.some((p) => p.test(source)) || usesAny(source, bindings.data);
  const service = SERVICE_CALL_PATTERNS.some((p) => p.test(source)) || usesAny(source, bindings.service);
  return data || service ? { data, service } : null;
}

// ---------------------------------------------------------------------------
// Middleware (called "proxy" in Next.js 16)
// ---------------------------------------------------------------------------

const MIDDLEWARE_FILE_PATTERN =
  /^(?:(?:apps|packages)\/[^/]+\/)?(?:src\/)?(?:middleware|proxy)\.(?:ts|js|mjs)$/;

// Signs that the middleware actually blocks signed-out visitors. A bare clerkMiddleware()
// does not: Clerk leaves every route public unless it also calls auth.protect().
const MIDDLEWARE_AUTH_PATTERNS = [
  /\bauth\.protect\s*\(/,
  /\bauthMiddleware\b/,
  /\bwithAuth\b/,
  /next-auth\/middleware/,
  /export\s*\{\s*auth\s+as\s+middleware\s*\}/,
  /export\s+default\s+auth\s*\(/,
  /\bgetToken\s*\(/,
  /\bgetUser\s*\(/,
  /\bgetSession\s*\(/,
  /\bupdateSession\b/,
  /\b(?:jwtVerify|verifyToken)\s*\(/,
  /NextResponse\.redirect\([^)]*(?:login|sign-?in)/i,
];

/** Does the middleware's `config.matcher` include /api routes? */
function middlewareCoversApi(content: string): boolean {
  const match = content.match(/matcher\s*:\s*(\[[\s\S]*?\]|"[^"]*"|'[^']*'|`[^`]*`)/);
  if (!match) return true; // no matcher: it runs on every request
  const matcher = match[1];
  if (/\(\?!\s*[^)]*\bapi\b/.test(matcher)) return false; // "everything except api..."
  if (/\(\?!/.test(matcher)) return true; // "everything except static files"
  return /\bapi\b/.test(matcher);
}

/** Returns the path of an auth middleware that covers /api routes, if the repo has one. */
function findAuthMiddleware(files: ScanFile[]): string | null {
  for (const file of files) {
    const path = file.path.replace(/\\/g, "/");
    if (!MIDDLEWARE_FILE_PATTERN.test(path)) continue;
    if (!MIDDLEWARE_AUTH_PATTERNS.some((p) => p.test(file.content))) continue;
    if (middlewareCoversApi(file.content)) return path;
  }
  return null;
}

function nodeContainsAuthCheck(node: Node, fileContent: string): boolean {
  const start = node.start ?? 0;
  const end = node.end ?? fileContent.length;
  const source = fileContent.slice(start, end);
  return isAuthCallSource(source);
}

function findPagesRouterMethods(content: string): { method: string; lineNumber: number }[] {
  const methods: { method: string; lineNumber: number }[] = [];
  const seen = new Set<string>();
  const methodPattern = /req\.method\s*===?\s*['"](POST|PUT|DELETE|PATCH)['"]/gi;
  let match: RegExpExecArray | null;
  while ((match = methodPattern.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    if (seen.has(method)) continue;
    seen.add(method);
    methods.push({
      method,
      lineNumber: content.slice(0, match.index).split("\n").length,
    });
  }
  return methods;
}

function pagesHandlerHasAuth(content: string): boolean {
  return isAuthCallSource(content);
}

/** Expressions we can treat as "the handler body": `async () => {}`, `async function () {}`, or `wrap(...)`. */
function isAnalyzableInit(node: Node | null | undefined): node is Node {
  return (
    !!node &&
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "CallExpression")
  );
}

interface RouteHit {
  method: string;
  lineNumber: number;
  touch: Touch;
}

function analyzeAppRouterFile(file: ScanFile): RouteHit[] {
  const findings: RouteHit[] = [];

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(file.content, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: true,
    });
  } catch {
    return findings;
  }

  const checked = new Set<string>();
  const bindings = collectImportedBindings(file.content);

  // Reports each HTTP method at most once per file.
  const check = (method: string | null, node: Node, line: number) => {
    if (!method || checked.has(method)) return;
    checked.add(method);
    if (nodeContainsAuthCheck(node, file.content)) return;

    const source = file.content.slice(node.start ?? 0, node.end ?? file.content.length);
    const touch = detectTouch(source, bindings);
    if (touch) findings.push({ method, lineNumber: line, touch });
  };

  traverse(ast, {
    ExportNamedDeclaration(path) {
      const decl = path.node.declaration;

      // export async function POST() {}
      if (decl?.type === "FunctionDeclaration") {
        if (decl.id?.name) check(getHandlerMethod(decl.id.name), decl, decl.loc?.start.line ?? 1);
        return;
      }

      // export const POST = async (req) => {}  /  = async function () {}  /  = withSomething(async () => {})
      if (decl?.type === "VariableDeclaration") {
        for (const d of decl.declarations) {
          if (d.id.type !== "Identifier" || !isAnalyzableInit(d.init)) continue;
          check(getHandlerMethod(d.id.name), d.init, d.loc?.start.line ?? 1);
        }
        return;
      }

      // export { handler as POST }
      if (!path.node.source) {
        for (const spec of path.node.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          const exported = spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
          const method = getHandlerMethod(exported);
          if (!method) continue;

          const target = path.scope.getBinding(spec.local.name)?.path.node;
          if (target?.type === "FunctionDeclaration") {
            check(method, target, target.loc?.start.line ?? 1);
          } else if (target?.type === "VariableDeclarator" && isAnalyzableInit(target.init)) {
            check(method, target.init, target.loc?.start.line ?? 1);
          }
        }
      }
    },
    FunctionDeclaration(path) {
      if (path.parent.type === "ExportNamedDeclaration") return;
      const name = path.node.id?.name;
      if (!name) return;
      check(getHandlerMethod(name), path.node, path.node.loc?.start.line ?? 1);
    },
  });

  return findings;
}

function describeTouch(touch: Touch): string {
  const parts: string[] = [];
  if (touch.data) parts.push("change data in your database or storage");
  if (touch.service) parts.push("call a paid or external service (such as an AI or email API)");
  const sentence = `appears to ${parts.join(" and ")}`;
  return touch.service ? `${sentence}, so anyone who finds the URL could run up your bill` : sentence;
}

function makeFinding(
  filePath: string,
  hit: RouteHit,
  middlewarePath: string | null,
): UnprotectedRouteFinding {
  const { method, lineNumber, touch } = hit;
  const extra = touch.service ? " Rate limiting is also worth adding." : "";

  if (middlewarePath) {
    return {
      type: "unprotected_route",
      severity: "medium",
      filePath,
      lineNumber,
      method,
      description: `No authentication check was found inside this ${method} handler, and it ${describeTouch(touch)}. ${middlewarePath} looks like an auth middleware that covers /api routes, so this may already be protected. It's worth confirming this path isn't on the middleware's public list.`,
      fixSuggestion: `Open ${middlewarePath} and confirm it requires a signed-in user for this route. Adding a check inside the handler as well (e.g. supabase.auth.getUser() or auth()) is a good second layer.${extra}`,
    };
  }

  return {
    type: "unprotected_route",
    severity: "high",
    filePath,
    lineNumber,
    method,
    description: `No authentication check was found in this ${method} handler, and it ${describeTouch(touch)}. Next.js route handlers are public by default, so anyone who knows the URL can call this one unless something else restricts it.`,
    fixSuggestion: `If only signed-in users should use this endpoint, check the session at the start of the handler (e.g. supabase.auth.getUser(), auth() or getServerSession()) and return 401 if there isn't one. If it is meant to be public, you can ignore this finding, but validate the input and consider rate limiting.${extra}`,
  };
}

function analyzeRouteFile(file: ScanFile, middlewarePath: string | null): UnprotectedRouteFinding[] {
  if (isPublicByDesign(file)) return [];

  const isPagesApi = /pages\/api\//.test(file.path.replace(/\\/g, "/"));

  let hits: RouteHit[];
  if (isPagesApi) {
    // Import lines are removed so that merely importing a database client doesn't count.
    const body = file.content.replace(IMPORT_PATTERN, "");
    const touch = pagesHandlerHasAuth(file.content)
      ? null
      : detectTouch(body, collectImportedBindings(file.content));
    hits = touch
      ? findPagesRouterMethods(file.content).map(({ method, lineNumber }) => ({ method, lineNumber, touch }))
      : [];
  } else {
    hits = analyzeAppRouterFile(file);
  }

  return hits.map((hit) => makeFinding(file.path, hit, middlewarePath));
}

/**
 * Finds API route handlers that change data or call paid services without any sign of an
 * auth check. Handlers that do neither are not reported.
 *
 * Next.js has no built-in "protected" flag: a route is public unless the developer restricts
 * it. So this is a best-effort reading of the code. It accepts auth calls, signature checks
 * (webhooks) and shared-secret checks (cron jobs) as protection, skips sign-in routes, and
 * lowers the severity when an auth middleware covering /api exists in the repo.
 */
export function scanRoutes(files: ScanFile[]): UnprotectedRouteFinding[] {
  const middlewarePath = findAuthMiddleware(files);
  return files
    .filter((f) => isRouteFile(f.path))
    .flatMap((file) => analyzeRouteFile(file, middlewarePath));
}
