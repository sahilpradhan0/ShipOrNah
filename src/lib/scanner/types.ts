export type ScanType = "repo";

export type FindingSeverity = "critical" | "high" | "medium";

export interface ScanFile {
  path: string;
  content: string;
}

export interface SecretFinding {
  type: "secret";
  severity: FindingSeverity;
  service: string;
  /** Specific headline, e.g. "Exposed OpenAI admin API key". Older saved scans don't have it. */
  title?: string;
  filePath: string;
  lineNumber: number;
  snippetPreview: string;
  description: string;
  fixSuggestion: string;
}

export interface MissingRlsFinding {
  type: "missing_rls";
  severity: "critical";
  tableName: string;
  filePath: string;
  lineNumber: number;
  description: string;
  fixSuggestion: string;
}

export interface UnprotectedRouteFinding {
  type: "unprotected_route";
  severity: "high" | "medium";
  filePath: string;
  lineNumber: number;
  method: string;
  description: string;
  fixSuggestion: string;
}

export interface WeakRlsFinding {
  type: "weak_rls";
  severity: "critical";
  tableName: string;
  filePath: string;
  lineNumber: number;
  description: string;
  fixSuggestion: string;
}

export interface ExposedFileFinding {
  type: "exposed_file";
  severity: "critical";
  fileUrl: string;
  description: string;
  fixSuggestion: string;
}

export type Finding =
  | SecretFinding
  | MissingRlsFinding
  | WeakRlsFinding
  | UnprotectedRouteFinding
  | ExposedFileFinding;

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  /**
   * How many of the `high` findings are route findings. They are best-effort guesses, so
   * the health score weighs them less than certain findings. Missing on older saved scans.
   */
  routes?: number;
}

export interface ScanTarget {
  type: ScanType;
  url: string;
}

export interface ScanResponse {
  healthScore: number;
  scannedAt: string;
  target: ScanTarget;
  summary: ScanSummary;
  findings: Finding[];
}

export interface ScanRequestBody {
  type: ScanType;
  url: string;
}
