import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import type { Node } from "@babel/types";
import type { ScanFile, UnprotectedRouteFinding } from "./types";

const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;

const ROUTE_FILE_PATTERN =
  /(?:^|\/)(?:app\/api\/.*\/route\.(ts|js)|pages\/api\/.*\.(ts|js))$/;

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

const AUTH_CALL_PATTERNS = [
  /supabase\.auth\.getUser\s*\(/,
  /\bauth\s*\(\s*\)/,
  /\bgetServerSession\s*\(/,
  /\brequireAuth\s*\(/,
];


function isRouteFile(path: string): boolean {
  return ROUTE_FILE_PATTERN.test(path.replace(/\\/g, "/"));
}

function getHandlerMethod(name: string): string | null {
  const upper = name.toUpperCase();
  return MUTATING_METHODS.has(upper) ? upper : null;
}

function isAuthCallSource(source: string): boolean {
  if (AUTH_CALL_PATTERNS.some((p) => p.test(source))) return true;
  return /\b\w*(auth|session)\w*\s*\(/i.test(source);
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

function analyzeAppRouterFile(file: ScanFile): UnprotectedRouteFinding[] {
  const findings: UnprotectedRouteFinding[] = [];

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

  // Reports each HTTP method at most once per file.
  const check = (method: string | null, node: Node, line: number) => {
    if (!method || checked.has(method)) return;
    checked.add(method);
    if (!nodeContainsAuthCheck(node, file.content)) {
      findings.push(makeFinding(file.path, method, line));
    }
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

function makeFinding(filePath: string, method: string, lineNumber: number): UnprotectedRouteFinding {
  return {
    type: "unprotected_route",
    severity: "high",
    filePath,
    lineNumber,
    method,
    description: `This ${method} handler does not appear to verify authentication before handling the request.`,
    fixSuggestion:
      "Add an auth check at the start of the handler (e.g. supabase.auth.getUser(), auth(), or getServerSession()) and return 401 if the user is not authenticated.",
  };
}

function analyzeRouteFile(file: ScanFile): UnprotectedRouteFinding[] {
  const isPagesApi = /pages\/api\//.test(file.path.replace(/\\/g, "/"));

  if (isPagesApi) {
    const methods = findPagesRouterMethods(file.content);
    if (methods.length > 0 && !pagesHandlerHasAuth(file.content)) {
      return methods.map(({ method, lineNumber }) => makeFinding(file.path, method, lineNumber));
    }
    return [];
  }

  return analyzeAppRouterFile(file);
}

/**
 * Detect API route handlers that mutate data without an auth check.
 */
export function scanRoutes(files: ScanFile[]): UnprotectedRouteFinding[] {
  return files
    .filter((f) => isRouteFile(f.path))
    .flatMap((file) => analyzeRouteFile(file));
}
