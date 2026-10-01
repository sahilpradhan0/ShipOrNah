import type { ScanType } from "@/lib/scanner/types";

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function detectScanType(input: string): ScanType | null {
  try {
    const url = new URL(normalizeUrl(input));
    const host = url.hostname.replace(/^www\./, "");
    if (host === "github.com") return "repo";
  } catch {
    // fall through to null
  }
  return null;
}

export function scanTypeLabel(type: ScanType): string {
  return "GitHub repo";
}
