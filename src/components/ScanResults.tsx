import type { Finding, ScanResponse } from "@/lib/scanner/types";
import {
  getFindingLocation,
  getFindingTitle,
  getScoreColor,
  getSeverityStyles,
  groupFindingsBySeverity,
} from "@/lib/findings";
import ShareActions from "./ShareActions";

interface ScanResultsProps {
  result: ScanResponse;
  shareUrl: string;
  /** Optional heading for share/report views */
  reportTitle?: string;
}

const SEVERITY_ORDER = ["critical", "high", "medium"] as const;

function ScoreRing({ score }: { score: number }) {
  const colors = getScoreColor(score);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, score)) / 100;
  const dashOffset = circumference * (1 - progress);

  return (
    <div
      className={`relative flex h-40 w-40 items-center justify-center rounded-sm shadow-lg ${colors.glow}`}
    >
      <svg
        className="absolute inset-0 h-full w-full -rotate-90"
        viewBox="0 0 120 120"
        aria-hidden
      >
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          className="stroke-zinc-800"
          strokeWidth="8"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          className={colors.ring}
          strokeWidth="8"
          strokeLinecap="square"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="relative text-center">
        <p className={`text-5xl font-semibold tabular-nums tracking-tight ${colors.text}`}>
          {score}
        </p>
        <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Health score</p>
      </div>
    </div>
  );
}

function SeverityBadge({
  severity,
  count,
}: {
  severity: "critical" | "high" | "medium";
  count: number;
}) {
  const styles = getSeverityStyles(severity);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium ${styles.badge}`}
    >
      <span>{styles.label}</span>
      <span className="font-mono tabular-nums">{count}</span>
    </span>
  );
}

function SeverityIcon({ severity }: { severity: Finding["severity"] }) {
  const styles = getSeverityStyles(severity);
  return (
    <svg
      className={`mt-0.5 h-4 w-4 shrink-0 ${styles.icon}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      {severity === "critical" ? (
        <>
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        </>
      ) : severity === "high" ? (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </>
      )}
    </svg>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const styles = getSeverityStyles(finding.severity);
  const title = getFindingTitle(finding);
  const location = getFindingLocation(finding);
  const snippet =
    finding.type === "secret" && finding.snippetPreview
      ? finding.snippetPreview
      : null;

  return (
    <article
      className={`rounded-sm border bg-zinc-900/50 p-4 ${styles.border}`}
    >
      <div className="flex gap-3">
        <SeverityIcon severity={finding.severity} />
        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>

          {location && (
            <p className="font-mono text-xs text-zinc-500 break-all">{location}</p>
          )}

          {snippet && (
            <pre className="overflow-x-auto rounded-sm border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-400">
              {snippet}
            </pre>
          )}

          <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-400">{finding.description}</p>

          <details className="group">
            <summary className="cursor-pointer list-none text-sm text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition hover:text-white [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show fix suggestion</span>
              <span className="hidden group-open:inline">Hide fix suggestion</span>
            </summary>
            <p className="mt-2 rounded-sm border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-300">
              {finding.fixSuggestion}
            </p>
          </details>
        </div>
      </div>
    </article>
  );
}

function CleanScanState({ targetUrl }: { targetUrl: string }) {
  return (
    <div className="rounded-sm border border-emerald-500/25 bg-emerald-500/5 px-6 py-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-sm border border-emerald-500/30 bg-emerald-500/10">
        <svg
          className="h-7 w-7 text-emerald-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h2 className="text-lg font-medium text-emerald-300">No issues found</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
        We scanned{" "}
        <span className="font-mono text-zinc-300">{targetUrl}</span> and didn&apos;t
        detect exposed secrets, missing RLS, or unprotected routes. Share this report
        — a clean bill of health is worth showing off.
      </p>
    </div>
  );
}

export default function ScanResults({ result, reportTitle, shareUrl }: ScanResultsProps) {
  const grouped = groupFindingsBySeverity(result.findings);
  const isClean = result.healthScore === 100 && result.findings.length === 0;
  const scannedDate = new Date(result.scannedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6">
      {reportTitle && (
        <header className="space-y-1 border-b border-zinc-800 pb-6">
          <p className="text-xs uppercase tracking-widest text-zinc-500">Security report</p>
          <h1 className="text-xl font-medium text-zinc-100 sm:text-2xl">{reportTitle}</h1>
          <p className="font-mono text-sm text-zinc-500 break-all">{result.target.url}</p>
        </header>
      )}

      <section className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-between">
        <ScoreRing score={result.healthScore} />
        <div className="space-y-4 text-center sm:text-left">
          <div>
            <p className="text-sm text-zinc-500">Scanned</p>
            <p className="text-sm text-zinc-300">{scannedDate}</p>
          </div>
          <div>
            <p className="mb-2 text-sm text-zinc-500">Findings</p>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <SeverityBadge severity="critical" count={result.summary.critical} />
              <SeverityBadge severity="high" count={result.summary.high} />
              <SeverityBadge severity="medium" count={result.summary.medium} />
            </div>
          </div>
          <div>
            <ShareActions
              shareUrl={shareUrl}
              title={reportTitle ?? "ShipOrNah Security Report"}
              result={result}
            />
          </div>
        </div>
      </section>

      {isClean ? (
        <CleanScanState targetUrl={result.target.url} />
      ) : (
        <section className="space-y-8">
          {SEVERITY_ORDER.map((severity) => {
            const findings = grouped[severity];
            if (findings.length === 0) return null;

            const styles = getSeverityStyles(severity);
            return (
              <div key={severity} className="space-y-3">
                <h2 className={`text-sm font-medium uppercase tracking-wider ${styles.icon}`}>
                  {styles.label} ({findings.length})
                </h2>
                <div className="space-y-3">
                  {findings.map((finding, index) => (
                    <FindingCard
                      key={`${finding.type}-${getFindingLocation(finding) ?? index}-${index}`}
                      finding={finding}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
