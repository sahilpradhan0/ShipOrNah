import type { Finding, FindingSeverity, ScanSummary } from "@/lib/scanner/types";

// Each extra finding of the same severity counts a little less than the one before it
// (`decay`), so a long list of lower-severity findings can't wipe out the whole score on
// its own. `first` is what the first finding of that severity costs.
const SEVERITY_PENALTY: Record<FindingSeverity, { first: number; decay: number }> = {
  critical: { first: 25, decay: 0.85 },
  high: { first: 8, decay: 0.8 },
  medium: { first: 3, decay: 0.8 },
};

// Route findings are educated guesses (the scanner can't see every way a route is protected),
// so they get their own, lighter scale: by themselves they can lower the score but never
// sink it the way a confirmed leak does.
const ROUTE_PENALTY = { first: 5, decay: 0.8 };

function geometricPenalty(first: number, decay: number, count: number): number {
  if (count <= 0) return 0;
  // first + first*decay + first*decay^2 + ... for `count` findings.
  return (first * (1 - Math.pow(decay, count))) / (1 - decay);
}

function penaltyFor(severity: FindingSeverity, count: number): number {
  const { first, decay } = SEVERITY_PENALTY[severity];
  return geometricPenalty(first, decay, count);
}

export function buildSummary(findings: Finding[]): ScanSummary {
  const summary: ScanSummary = { critical: 0, high: 0, medium: 0, routes: 0 };
  for (const finding of findings) {
    summary[finding.severity]++;
    if (finding.type === "unprotected_route" && finding.severity === "high") {
      summary.routes = (summary.routes ?? 0) + 1;
    }
  }
  return summary;
}

export function calculateHealthScore(summary: ScanSummary): number {
  const routes = Math.min(summary.routes ?? 0, summary.high);
  const penalty =
    penaltyFor("critical", summary.critical) +
    penaltyFor("high", summary.high - routes) +
    penaltyFor("medium", summary.medium) +
    geometricPenalty(ROUTE_PENALTY.first, ROUTE_PENALTY.decay, routes);
  return Math.max(0, Math.round(100 - penalty));
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
