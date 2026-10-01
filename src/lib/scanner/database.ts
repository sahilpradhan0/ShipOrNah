import type { MissingRlsFinding, ScanFile, WeakRlsFinding } from "./types";

const CREATE_TABLE_PATTERN =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_"]+)/gi;

const ENABLE_RLS_PATTERN =
  /ALTER\s+TABLE\s+public\.([a-zA-Z0-9_"]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/gi;

// Captures each full CREATE POLICY ... ; statement along with the table it targets,
// so we can inspect its USING/WITH CHECK clause for weak (effectively-public) conditions.
const CREATE_POLICY_PATTERN =
  /CREATE\s+POLICY\s+[^;]*?\bON\s+public\.([a-zA-Z0-9_"]+)[^;]*?;/gi;

const WEAK_CONDITION_PATTERN = /(?:USING|WITH\s+CHECK)\s*\(\s*true\s*\)/i;

function normalizeTableName(raw: string): string {
  return raw.replace(/"/g, "").toLowerCase();
}

function getLineNumber(content: string, index: number): number {
  // Count newlines before the match position — 1-indexed for display.
  return content.slice(0, index).split("\n").length;
}

function isSqlFile(path: string): boolean {
  return path.endsWith(".sql") || /\/migrations\//i.test(path);
}

interface TableMatch {
  name: string;
  lineNumber: number;
}

function extractCreatedTables(content: string): TableMatch[] {
  const tables: TableMatch[] = [];
  CREATE_TABLE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CREATE_TABLE_PATTERN.exec(content)) !== null) {
    tables.push({
      name: normalizeTableName(match[1]),
      lineNumber: getLineNumber(content, match.index),
    });
  }
  return tables;
}

function extractRlsEnabledTables(allSql: string): Set<string> {
  const enabled = new Set<string>();
  ENABLE_RLS_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENABLE_RLS_PATTERN.exec(allSql)) !== null) {
    enabled.add(normalizeTableName(match[1]));
  }
  return enabled;
}

interface WeakPolicyMatch {
  tableName: string;
  lineNumber: number;
}

/**
 * Find CREATE POLICY statements whose USING or WITH CHECK clause is the
 * literal `true` — this grants unconditional access to every row for
 * whichever operation the policy covers, which defeats the purpose of
 * enabling RLS in the first place even though RLS is technically "on".
 * Only the first weak policy per table is returned (one finding per table).
 */
function extractWeakPolicies(files: ScanFile[]): Map<string, WeakPolicyMatch> {
  const weak = new Map<string, WeakPolicyMatch>();

  for (const file of files) {
    CREATE_POLICY_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CREATE_POLICY_PATTERN.exec(file.content)) !== null) {
      const tableName = normalizeTableName(match[1]);
      if (weak.has(tableName)) continue;
      if (WEAK_CONDITION_PATTERN.test(match[0])) {
        weak.set(tableName, {
          tableName,
          lineNumber: getLineNumber(file.content, match.index),
        });
      }
    }
  }

  return weak;
}

/**
 * Check Supabase/Postgres migrations for tables missing Row Level Security,
 * and separately for tables that have RLS enabled but with a policy that
 * effectively grants access to everyone anyway.
 */
export function scanDatabase(
  files: ScanFile[],
): (MissingRlsFinding | WeakRlsFinding)[] {
  const sqlFiles = files.filter((f) => isSqlFile(f.path));
  if (sqlFiles.length === 0) return [];

  const allSql = sqlFiles.map((f) => f.content).join("\n");
  const rlsEnabled = extractRlsEnabledTables(allSql);
  const weakPolicies = extractWeakPolicies(sqlFiles);

  const findings: (MissingRlsFinding | WeakRlsFinding)[] = [];
  const seenMissing = new Set<string>();
  const seenWeak = new Set<string>();

  for (const file of sqlFiles) {
    for (const { name: tableName, lineNumber } of extractCreatedTables(file.content)) {
      if (rlsEnabled.has(tableName)) {
        // RLS is enabled — check separately whether its policy is actually
        // meaningful, or just `USING (true)` window dressing.
        const weak = weakPolicies.get(tableName);
        if (weak && !seenWeak.has(tableName)) {
          seenWeak.add(tableName);
          findings.push({
            type: "weak_rls",
            severity: "critical",
            tableName,
            filePath: file.path,
            lineNumber: weak.lineNumber,
            description: `Table '${tableName}' has Row Level Security enabled, but its policy allows access to every row regardless of who's asking (USING/WITH CHECK evaluates to true for everyone). This offers no real protection.`,
            fixSuggestion: `Scope the policy to the requesting user, e.g.:\n\nCREATE POLICY "Users can view own rows" ON public.${tableName}\n  FOR SELECT USING (auth.uid() = user_id);`,
          });
        }
        continue;
      }

      if (seenMissing.has(tableName)) continue;
      seenMissing.add(tableName);

      findings.push({
        type: "missing_rls",
        severity: "critical",
        tableName,
        filePath: file.path,
        lineNumber,
        description: `Table '${tableName}' is created without enabling Row Level Security. Any authenticated user could read or modify all rows.`,
        fixSuggestion: `Add this to your migration after creating the table:\n\nALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY;`,
      });
    }
  }

  return findings;
}
