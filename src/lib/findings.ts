import type { Finding, FindingSeverity } from "@/lib/scanner/types";

export function getScoreColor(score: number): {
  ring: string;
  text: string;
  glow: string;
} {
  if (score >= 80) {
    return {
      ring: "stroke-emerald-500",
      text: "text-emerald-400",
      glow: "shadow-emerald-500/20",
    };
  }
  if (score >= 50) {
    return {
      ring: "stroke-amber-500",
      text: "text-amber-400",
      glow: "shadow-amber-500/20",
    };
  }
  return {
    ring: "stroke-red-500",
    text: "text-red-400",
    glow: "shadow-red-500/20",
  };
}

export function getSeverityStyles(severity: FindingSeverity): {
  badge: string;
  border: string;
  icon: string;
  label: string;
} {
  switch (severity) {
    case "critical":
      return {
        badge: "bg-red-500/15 text-red-400 border-red-500/30",
        border: "border-red-500/25",
        icon: "text-red-400",
        label: "Critical",
      };
    case "high":
      return {
        badge: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        border: "border-amber-500/25",
        icon: "text-amber-400",
        label: "High",
      };
    case "medium":
      return {
        badge: "bg-sky-500/15 text-sky-400 border-sky-500/30",
        border: "border-sky-500/25",
        icon: "text-sky-400",
        label: "Medium",
      };
  }
}

export function getFindingTitle(finding: Finding): string {
  switch (finding.type) {
    case "secret":
      if (finding.title) return finding.title;
      // Fallback for scans saved before findings carried their own title.
      return finding.service.toLowerCase().includes("possible")
        ? `Possible exposed API key (${finding.service})`
        : `Exposed ${finding.service} API key`;
    case "missing_rls":
      return `Missing RLS on table '${finding.tableName}'`;
    case "weak_rls":
      return `Weak RLS policy on table '${finding.tableName}'`;
    case "unprotected_route":
      return `Unprotected ${finding.method} route`;
    case "exposed_file":
      return "Publicly exposed sensitive file";
  }
}

export function getFindingLocation(finding: Finding): string | null {
  if (finding.type === "secret") {
    return `${finding.filePath}:${finding.lineNumber}`;
  }
  if (finding.type === "missing_rls" || finding.type === "weak_rls") {
    return `${finding.filePath}:${finding.lineNumber}`;
  }
  if (finding.type === "unprotected_route") {
    return `${finding.filePath}:${finding.lineNumber}`;
  }
  if (finding.type === "exposed_file") {
    return finding.fileUrl;
  }
  return null;
}

export function groupFindingsBySeverity(
  findings: Finding[],
): Record<FindingSeverity, Finding[]> {
  const groups: Record<FindingSeverity, Finding[]> = {
    critical: [],
    high: [],
    medium: [],
  };

  for (const finding of findings) {
    groups[finding.severity].push(finding);
  }

  return groups;
}
