import { ImageResponse } from "next/og";
import { truncateUrl } from "@/lib/scan-share";
import { getScanResult } from "@/lib/scan-store";

// Deliberately NOT edge runtime: the in-memory scan store lives in the Node.js
// process, and edge functions run in a separate isolate with no access to it.
// Once Phase 3 adds a real database, this constraint goes away and edge is fine again.

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

function getScoreColor(score: number): string {
  if (score >= 80) return "#34d399";
  if (score >= 50) return "#fbbf24";
  return "#f87171";
}

interface OgImageProps {
  params: Promise<{ id: string }>;
}

export default async function OgImage({ params }: OgImageProps) {
  const { id } = await params;
  const result = await getScanResult(id);

  if (!result) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#09090b",
            color: "#71717a",
            fontSize: 32,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          ShipOrNah — Report not found
        </div>
      ),
      { ...size },
    );
  }

  const scoreColor = getScoreColor(result.healthScore);
  const displayUrl = truncateUrl(result.target.url, 55);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#09090b",
          padding: "64px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div
            style={{
              fontSize: 28,
              color: "#a1a1aa",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            ShipOrNah
          </div>
          <div style={{ fontSize: 36, color: "#fafafa", lineHeight: 1.3, maxWidth: 900 }}>
            Security Report
          </div>
          <div style={{ fontSize: 22, color: "#71717a" }}>{displayUrl}</div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ fontSize: 20, color: "#71717a" }}>Health score</div>
            <div
              style={{
                fontSize: 120,
                fontWeight: 700,
                color: scoreColor,
                lineHeight: 1,
              }}
            >
              {result.healthScore}
              <span style={{ fontSize: 48, color: "#52525b" }}>/100</span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              alignItems: "flex-end",
            }}
          >
            <div style={{ display: "flex", gap: "16px", fontSize: 22 }}>
              <span style={{ color: "#f87171" }}>{result.summary.critical} critical</span>
              <span style={{ color: "#fbbf24" }}>{result.summary.high} high</span>
              <span style={{ color: "#38bdf8" }}>{result.summary.medium} medium</span>
            </div>
            <div style={{ fontSize: 18, color: "#52525b" }}>ShipOrNah</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
