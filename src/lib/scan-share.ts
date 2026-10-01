import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { ScanResponse } from "@/lib/scanner/types";

function isScanResponse(value: unknown): value is ScanResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScanResponse>;
  return (
    typeof candidate.healthScore === "number" &&
    typeof candidate.scannedAt === "string" &&
    !!candidate.target &&
    typeof candidate.target.url === "string" &&
    typeof candidate.target.type === "string" &&
    !!candidate.summary &&
    Array.isArray(candidate.findings)
  );
}

export function encodeScanResult(result: ScanResponse): string {
  return compressToEncodedURIComponent(JSON.stringify(result));
}

export function decodeScanResult(id: string): ScanResponse | null {
  try {
    const json = decompressFromEncodedURIComponent(id);
    if (!json) return null;
    const parsed: unknown = JSON.parse(json);
    return isScanResponse(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildSharePath(result: ScanResponse): string {
  return `/scan/${encodeScanResult(result)}`;
}

export function truncateUrl(url: string, maxLength = 60): string {
  if (url.length <= maxLength) return url;
  return `${url.slice(0, maxLength - 1)}…`;
}
