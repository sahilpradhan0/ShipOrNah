import { getFindingLocation, getFindingTitle } from "@/lib/findings";
import type { FindingSeverity, ScanResponse } from "@/lib/scanner/types";

/**
 * Draws the downloadable report card. Everything is laid out in CSS pixels on a
 * 1200px-wide canvas and exported at 2x so it stays sharp on retina screens.
 */

const WIDTH = 1200;
const PAD = 72;
const CONTENT_W = WIDTH - PAD * 2;
const EXPORT_SCALE = 2;
const MAX_LISTED_FINDINGS = 6;

const COLOR = {
  bg: "#09090b",
  panel: "#111113",
  border: "#27272a",
  track: "#27272a",
  text: "#fafafa",
  body: "#d4d4d8",
  muted: "#a1a1aa",
  faint: "#71717a",
  emerald: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
  sky: "#38bdf8",
};

const SEVERITY: Record<FindingSeverity, { color: string; label: string; hint: string }> = {
  critical: { color: COLOR.red, label: "CRITICAL", hint: "Fix immediately" },
  high: { color: COLOR.amber, label: "HIGH", hint: "Fix soon" },
  medium: { color: COLOR.sky, label: "MEDIUM", hint: "Worth reviewing" },
};
const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium"];

export interface ReportImageFonts {
  sans: string;
  mono: string;
}

export interface ReportImageOptions {
  /** Link to the online report, printed in the footer. */
  shareUrl: string;
  /** Font stacks. Defaults to the page's own fonts when omitted (browser only). */
  fonts?: ReportImageFonts;
}

type Ctx = CanvasRenderingContext2D;

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRoundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
  stroke?: string,
) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Letter-spacing isn't available in every browser; skip it quietly when missing. */
function setTracking(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  }
}

function setFont(ctx: Ctx, weight: number, size: number, family: string) {
  ctx.font = `${weight} ${size}px ${family}`;
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  opts: {
    weight?: number;
    size: number;
    family: string;
    color: string;
    tracking?: number;
    align?: "left" | "right" | "center";
  },
) {
  setFont(ctx, opts.weight ?? 400, opts.size, opts.family);
  setTracking(ctx, opts.tracking ?? 0);
  ctx.fillStyle = opts.color;
  ctx.textBaseline = "top";
  ctx.textAlign = opts.align ?? "left";
  ctx.fillText(value, x, y);
  setTracking(ctx, 0);
  ctx.textAlign = "left";
}

function measure(ctx: Ctx, value: string, weight: number, size: number, family: string, tracking = 0) {
  setFont(ctx, weight, size, family);
  setTracking(ctx, tracking);
  const width = ctx.measureText(value).width;
  setTracking(ctx, 0);
  return width;
}

/** Cuts text to fit, ending with an ellipsis. */
function fitEnd(ctx: Ctx, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${value.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${value.slice(0, low).trimEnd()}…`;
}

/** Cuts text from the start so the end (file name and line number) stays visible. */
function fitStart(ctx: Ctx, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`…${value.slice(value.length - mid)}`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `…${value.slice(value.length - low)}`;
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

function getVerdict(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "SHIP IT", color: COLOR.emerald };
  if (score >= 50) return { label: "FIX FIRST", color: COLOR.amber };
  return { label: "NAH", color: COLOR.red };
}

function getProjectName(targetUrl: string): string {
  try {
    const target = new URL(targetUrl);
    const segments = target.pathname.split("/").filter(Boolean);
    const name =
      target.hostname.toLowerCase() === "github.com" && segments.length > 1
        ? segments[1]
        : segments[segments.length - 1];
    return name?.replace(/\.git$/i, "") || target.hostname;
  } catch {
    return (
      targetUrl.replace(/\.git$/i, "").split(/[/?#]/).filter(Boolean).pop() || "Project"
    );
  }
}

function getDisplayUrl(targetUrl: string): string {
  return targetUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\.git$/i, "");
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

// ---------------------------------------------------------------------------
// The painter
// ---------------------------------------------------------------------------

/**
 * Paints the whole card and returns its height in CSS pixels. `canvasHeight` is
 * only used to fill the background, so call it once on a tall scratch canvas to
 * measure, then again on a canvas of the returned height.
 */
export function paintReportImage(
  ctx: Ctx,
  result: ScanResponse,
  options: ReportImageOptions & { fonts: ReportImageFonts },
  canvasHeight: number,
): number {
  const { sans, mono } = options.fonts;
  const verdict = getVerdict(result.healthScore);
  const total = result.summary.critical + result.summary.high + result.summary.medium;

  // Background ------------------------------------------------------------
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, WIDTH, canvasHeight);

  const ringX = WIDTH - PAD - 112;
  const heroTop = 168;
  const ringY = heroTop + 112;

  const glow = ctx.createRadialGradient(ringX, ringY, 0, ringX, ringY, 560);
  glow.addColorStop(0, withAlpha(verdict.color, 0.17));
  glow.addColorStop(1, withAlpha(verdict.color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, ringY + 561);

  for (let gy = 16; gy < 520; gy += 32) {
    for (let gx = 16; gx < WIDTH; gx += 32) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.055 * (1 - gy / 520)})`;
      ctx.fillRect(gx, gy, 2, 2);
    }
  }

  const topLine = ctx.createLinearGradient(0, 0, WIDTH, 0);
  topLine.addColorStop(0, verdict.color);
  topLine.addColorStop(1, withAlpha(verdict.color, 0));
  ctx.fillStyle = topLine;
  ctx.fillRect(0, 0, WIDTH, 4);

  // Header ----------------------------------------------------------------
  const shipOrWidth = measure(ctx, "ShipOr", 700, 28, sans, -0.5);
  text(ctx, "ShipOr", PAD, PAD - 6, { weight: 700, size: 28, family: sans, color: COLOR.text, tracking: -0.5 });
  text(ctx, "Nah", PAD + shipOrWidth, PAD - 6, { weight: 700, size: 28, family: sans, color: COLOR.emerald, tracking: -0.5 });

  const tagText = "SECURITY REPORT";
  const tagWidth = measure(ctx, tagText, 600, 12, sans, 1.6) + 32;
  fillRoundRect(ctx, WIDTH - PAD - tagWidth, PAD - 6, tagWidth, 34, 17, "rgba(255,255,255,0.03)", COLOR.border);
  text(ctx, tagText, WIDTH - PAD - tagWidth + 16, PAD - 6 + 10, {
    weight: 600, size: 12, family: sans, color: COLOR.muted, tracking: 1.6,
  });

  // Hero: project + verdict (left) ---------------------------------------
  const leftWidth = CONTENT_W - 290;
  let y = heroTop;

  text(ctx, "SCAN RESULTS FOR", PAD, y, { weight: 600, size: 13, family: sans, color: COLOR.faint, tracking: 1.8 });
  y += 30;

  const projectName = getProjectName(result.target.url);
  let nameSize = 64;
  while (nameSize > 36 && measure(ctx, projectName, 700, nameSize, sans, -1.5) > leftWidth) nameSize -= 4;
  setFont(ctx, 700, nameSize, sans);
  setTracking(ctx, -1.5);
  const shownName = fitEnd(ctx, projectName, leftWidth);
  setTracking(ctx, 0);
  text(ctx, shownName, PAD, y, { weight: 700, size: nameSize, family: sans, color: COLOR.text, tracking: -1.5 });
  y += Math.round(nameSize * 1.15) + 8;

  setFont(ctx, 400, 17, mono);
  const shownUrl = fitEnd(ctx, getDisplayUrl(result.target.url), leftWidth);
  text(ctx, shownUrl, PAD, y, { size: 17, family: mono, color: COLOR.muted });
  y += 40;

  const verdictText = verdict.label;
  const verdictWidth = measure(ctx, verdictText, 700, 14, sans, 1.8) + 56;
  fillRoundRect(ctx, PAD, y, verdictWidth, 40, 20, withAlpha(verdict.color, 0.12), withAlpha(verdict.color, 0.4));
  ctx.beginPath();
  ctx.arc(PAD + 22, y + 20, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = verdict.color;
  ctx.fill();
  text(ctx, verdictText, PAD + 36, y + 12, { weight: 700, size: 14, family: sans, color: verdict.color, tracking: 1.8 });

  text(ctx, `Scanned ${formatDate(result.scannedAt)}`, PAD + verdictWidth + 20, y + 11, {
    size: 16, family: sans, color: COLOR.faint,
  });

  // Hero: score ring (right) ---------------------------------------------
  const ringRadius = 92;
  const ringWidth = 16;
  ctx.lineWidth = ringWidth;
  ctx.lineCap = "round";
  ctx.strokeStyle = COLOR.track;
  ctx.beginPath();
  ctx.arc(ringX, ringY, ringRadius, 0, Math.PI * 2);
  ctx.stroke();

  const progress = Math.min(0.9999, Math.max(0, result.healthScore) / 100);
  if (progress > 0) {
    ctx.save();
    const ringGradient = ctx.createLinearGradient(ringX - ringRadius, ringY + ringRadius, ringX + ringRadius, ringY - ringRadius);
    ringGradient.addColorStop(0, withAlpha(verdict.color, 0.65));
    ringGradient.addColorStop(1, verdict.color);
    ctx.strokeStyle = ringGradient;
    ctx.shadowColor = withAlpha(verdict.color, 0.55);
    ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.arc(ringX, ringY, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.restore();
  }
  ctx.lineCap = "butt";

  text(ctx, String(result.healthScore), ringX, ringY - 46, {
    weight: 700, size: 68, family: sans, color: COLOR.text, tracking: -2, align: "center",
  });
  text(ctx, "HEALTH SCORE", ringX, ringY + 32, {
    weight: 600, size: 12, family: sans, color: COLOR.faint, tracking: 1.6, align: "center",
  });

  // Severity cards ---------------------------------------------------------
  const cardsTop = heroTop + 246;
  const cardGap = 16;
  const cardWidth = (CONTENT_W - cardGap * 2) / 3;
  const cardHeight = 132;

  SEVERITY_ORDER.forEach((severity, index) => {
    const { color, label, hint } = SEVERITY[severity];
    const count = result.summary[severity];
    const x = PAD + index * (cardWidth + cardGap);
    const active = count > 0;

    fillRoundRect(ctx, x, cardsTop, cardWidth, cardHeight, 20, COLOR.panel);
    if (active) {
      const tint = ctx.createLinearGradient(x, cardsTop, x + cardWidth, cardsTop + cardHeight);
      tint.addColorStop(0, withAlpha(color, 0.14));
      tint.addColorStop(1, withAlpha(color, 0));
      fillRoundRect(ctx, x, cardsTop, cardWidth, cardHeight, 20, tint);
    }
    roundRectPath(ctx, x, cardsTop, cardWidth, cardHeight, 20);
    ctx.lineWidth = 1;
    ctx.strokeStyle = active ? withAlpha(color, 0.3) : COLOR.border;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + 30, cardsTop + 30, 5, 0, Math.PI * 2);
    ctx.fillStyle = active ? color : COLOR.faint;
    ctx.fill();
    text(ctx, label, x + 46, cardsTop + 23, { weight: 600, size: 13, family: sans, color: COLOR.muted, tracking: 1.6 });
    text(ctx, String(count), x + 26, cardsTop + 48, {
      weight: 700, size: 52, family: sans, color: active ? color : COLOR.faint, tracking: -1.5,
    });
    text(ctx, active ? hint : "None found", x + 26 + measure(ctx, String(count), 700, 52, sans, -1.5) + 16, cardsTop + 78, {
      size: 15, family: sans, color: COLOR.faint,
    });
  });

  // Distribution bar -------------------------------------------------------
  const barY = cardsTop + cardHeight + 24;
  const barHeight = 10;
  ctx.save();
  roundRectPath(ctx, PAD, barY, CONTENT_W, barHeight, barHeight / 2);
  ctx.clip();
  ctx.fillStyle = COLOR.track;
  ctx.fillRect(PAD, barY, CONTENT_W, barHeight);
  if (total === 0) {
    ctx.fillStyle = withAlpha(COLOR.emerald, 0.75);
    ctx.fillRect(PAD, barY, CONTENT_W, barHeight);
  } else {
    let bx = PAD;
    for (const severity of SEVERITY_ORDER) {
      const count = result.summary[severity];
      if (count === 0) continue;
      const w = (CONTENT_W * count) / total;
      ctx.fillStyle = SEVERITY[severity].color;
      ctx.fillRect(bx, barY, w, barHeight);
      ctx.fillStyle = COLOR.bg;
      ctx.fillRect(bx + w - 1.5, barY, 3, barHeight);
      bx += w;
    }
  }
  ctx.restore();

  // Findings list ----------------------------------------------------------
  y = barY + barHeight + 52;
  const shown = result.findings.slice(0, MAX_LISTED_FINDINGS);
  const hiddenCount = result.findings.length - shown.length;

  text(ctx, total === 0 ? "RESULT" : "TOP ISSUES", PAD, y, {
    weight: 600, size: 13, family: sans, color: COLOR.faint, tracking: 1.8,
  });
  if (total > 0) {
    text(ctx, `Showing ${shown.length} of ${result.findings.length}`, WIDTH - PAD, y - 1, {
      size: 14, family: sans, color: COLOR.faint, align: "right",
    });
  }
  y += 34;

  if (total === 0) {
    const boxHeight = 116;
    fillRoundRect(ctx, PAD, y, CONTENT_W, boxHeight, 20, withAlpha(COLOR.emerald, 0.07), withAlpha(COLOR.emerald, 0.25));
    const cx = PAD + 56;
    const cy = y + boxHeight / 2;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLOR.emerald;
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 1);
    ctx.lineTo(cx - 3, cy + 8);
    ctx.lineTo(cx + 11, cy - 8);
    ctx.stroke();
    ctx.lineCap = "butt";
    text(ctx, "No issues found", PAD + 106, y + 30, { weight: 600, size: 24, family: sans, color: COLOR.text });
    text(ctx, "No exposed secrets, missing RLS, or unprotected routes were detected.", PAD + 106, y + 66, {
      size: 16, family: sans, color: COLOR.muted,
    });
    y += boxHeight;
  } else {
    const rowHeight = 68;
    const moreHeight = hiddenCount > 0 ? 56 : 0;
    const listHeight = shown.length * rowHeight + moreHeight + 16;
    fillRoundRect(ctx, PAD, y, CONTENT_W, listHeight, 20, COLOR.panel, COLOR.border);

    shown.forEach((finding, index) => {
      const { color, label } = SEVERITY[finding.severity];
      const rowY = y + 8 + index * rowHeight;

      if (index > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(PAD + 28, rowY, CONTENT_W - 56, 1);
      }

      const tagW = measure(ctx, label, 700, 11, sans, 1.4) + 26;
      const textX = PAD + 58;
      const textMax = CONTENT_W - 58 - 28 - tagW - 24;

      ctx.beginPath();
      ctx.arc(PAD + 32, rowY + rowHeight / 2, 10, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(color, 0.16);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(PAD + 32, rowY + rowHeight / 2, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      setFont(ctx, 600, 19, sans);
      text(ctx, fitEnd(ctx, getFindingTitle(finding), textMax), textX, rowY + 12, {
        weight: 600, size: 19, family: sans, color: COLOR.text,
      });
      const location = getFindingLocation(finding);
      if (location) {
        setFont(ctx, 400, 14, mono);
        text(ctx, fitStart(ctx, location, textMax), textX, rowY + 40, { size: 14, family: mono, color: COLOR.muted });
      }

      const tagX = PAD + CONTENT_W - 28 - tagW;
      fillRoundRect(ctx, tagX, rowY + rowHeight / 2 - 13, tagW, 26, 13, withAlpha(color, 0.12), withAlpha(color, 0.32));
      text(ctx, label, tagX + 13, rowY + rowHeight / 2 - 6, { weight: 700, size: 11, family: sans, color, tracking: 1.4 });
    });

    if (hiddenCount > 0) {
      const moreY = y + 8 + shown.length * rowHeight;
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(PAD + 28, moreY, CONTENT_W - 56, 1);
      text(
        ctx,
        `+ ${hiddenCount} more ${hiddenCount === 1 ? "finding" : "findings"} in the full report`,
        PAD + 32,
        moreY + 19,
        { weight: 500, size: 16, family: sans, color: COLOR.muted },
      );
    }
    y += listHeight;
  }

  // Footer -----------------------------------------------------------------
  y += 44;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(PAD, y, CONTENT_W, 1);
  y += 26;

  const brandNah = measure(ctx, "Nah", 700, 16, sans);
  const brandShipOr = measure(ctx, "ShipOr", 700, 16, sans);
  const brandRight = WIDTH - PAD;
  text(ctx, "Nah", brandRight - brandNah, y, { weight: 700, size: 16, family: sans, color: COLOR.emerald });
  text(ctx, "ShipOr", brandRight - brandNah - brandShipOr, y, { weight: 700, size: 16, family: sans, color: COLOR.text });
  const generatedWidth = measure(ctx, "Generated by ", 400, 15, sans);
  text(ctx, "Generated by ", brandRight - brandNah - brandShipOr - generatedWidth, y + 1, {
    size: 15, family: sans, color: COLOR.faint,
  });

  setFont(ctx, 400, 15, mono);
  const linkMax = CONTENT_W - generatedWidth - brandNah - brandShipOr - 48;
  text(ctx, fitEnd(ctx, options.shareUrl.replace(/^https?:\/\//i, ""), linkMax), PAD, y + 1, {
    size: 15, family: mono, color: COLOR.muted,
  });

  return y + 20 + 48;
}

// ---------------------------------------------------------------------------
// Browser entry point
// ---------------------------------------------------------------------------

function readPageFonts(): ReportImageFonts {
  const body = getComputedStyle(document.body);
  const root = getComputedStyle(document.documentElement);
  const mono = root.getPropertyValue("--font-geist-mono").trim();
  return {
    sans: body.fontFamily || "Arial, Helvetica, sans-serif",
    mono: `${mono ? `${mono}, ` : ""}ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
  };
}

/** Makes sure the web fonts are loaded before drawing, otherwise canvas silently uses a fallback. */
async function ensureFontsLoaded(fonts: ReportImageFonts) {
  try {
    await Promise.all(
      [400, 500, 600, 700].flatMap((weight) => [
        document.fonts.load(`${weight} 16px ${fonts.sans}`),
        document.fonts.load(`${weight} 16px ${fonts.mono}`),
      ]),
    );
    await document.fonts.ready;
  } catch {
    // Fall back to whatever is available.
  }
}

export function reportImageFilename(result: ScanResponse): string {
  const slug = getDisplayUrl(result.target.url)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/, "");
  const date = /^\d{4}-\d{2}-\d{2}/.test(result.scannedAt)
    ? result.scannedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return `shipornah-report-${slug || "scan"}-${date}.png`;
}

export async function renderReportImage(
  result: ScanResponse,
  options: ReportImageOptions,
): Promise<Blob> {
  const fonts = options.fonts ?? readPageFonts();
  await ensureFontsLoaded(fonts);
  const opts = { ...options, fonts };

  // Pass 1: draw on a tall scratch canvas just to learn how tall the card is.
  const probe = document.createElement("canvas");
  probe.width = WIDTH;
  probe.height = 2400;
  const probeCtx = probe.getContext("2d");
  if (!probeCtx) throw new Error("Canvas is not supported in this browser.");
  const height = Math.ceil(paintReportImage(probeCtx, result, opts, probe.height));

  // Pass 2: draw for real at 2x resolution.
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * EXPORT_SCALE;
  canvas.height = height * EXPORT_SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
  paintReportImage(ctx, result, opts, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create the image.");
  return blob;
}
