import { NextResponse } from "next/server";
import { fetchGitHubRepo } from "@/lib/fetchers/scan-target";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { scanDatabase } from "@/lib/scanner/database";
import { scanRoutes } from "@/lib/scanner/routes";
import { calculateHealthScore, buildSummary, sortFindings } from "@/lib/scanner/score";
import { scanSecrets } from "@/lib/scanner/secrets";
import type { Finding, ScanRequestBody, ScanResponse } from "@/lib/scanner/types";
import { normalizeUrl } from "@/lib/scan-url";
import { saveScanResult } from "@/lib/scan-store";

function validateBody(body: unknown): ScanRequestBody | null {
  if (!body || typeof body !== "object") return null;
  const { type, url } = body as Partial<ScanRequestBody>;
  if (type !== "repo") return null;
  if (!url || typeof url !== "string" || url.trim().length === 0) return null;
  return { type, url: normalizeUrl(url) };
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json(
      {
        error: "You've hit the free scan limit for now. Try again in a minute.",
      },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input = validateBody(body);
  if (!input) {
    return NextResponse.json(
      { error: 'Request must include { "type": "repo", "url": string }.' },
      { status: 400 },
    );
  }

  try {
    const files = await fetchGitHubRepo(input.url);

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No scannable files found at this target." },
        { status: 422 },
      );
    }

    const findings: Finding[] = [
      ...scanSecrets(files),
      ...scanDatabase(files),
      ...scanRoutes(files),
    ];

    const summary = buildSummary(findings);
    const response: ScanResponse = {
      healthScore: calculateHealthScore(summary),
      scannedAt: new Date().toISOString(),
      target: { type: input.type, url: input.url },
      summary,
      findings: sortFindings(findings),
    };

    const shareId = await saveScanResult(response);

    return NextResponse.json({ ...response, shareId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Scan failed. Check the URL and try again.";
    const status = message.includes("not found") || message.includes("Invalid") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
