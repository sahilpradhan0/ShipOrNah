import type { Finding, FindingSeverity, ScanSummary } from "@/lib/scanner/types";

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  critical: 25,
  high: 15,
  medium: 5,
};

export function buildSummary(findings: Finding[]): ScanSummary {
  const summary: ScanSummary = { critical: 0, high: 0, medium: 0 };
  for (const finding of findings) {
    summary[finding.severity]++;
  }
  return summary;
}

export function calculateHealthScore(summary: ScanSummary): number {
  const penalty =
    summary.critical * SEVERITY_WEIGHT.critical +
    summary.high * SEVERITY_WEIGHT.high +
    summary.medium * SEVERITY_WEIGHT.medium;
  return Math.max(0, 100 - penalty);
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}
