import type { ScanResponse } from "@/lib/scanner/types";

export class ScanError extends Error {
  constructor(
    message: string,
    public status: number,
    public isRateLimited: boolean = false,
  ) {
    super(message);
    this.name = "ScanError";
  }
}

export async function runScan(
  type: "repo" | "app",
  url: string,
): Promise<ScanResponse & { shareId: string }> {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, url }),
  });

  let payload: { error?: string; message?: string } & Partial<ScanResponse> = {};
  try {
    payload = await response.json();
  } catch {
    // non-JSON body
  }

  if (!response.ok) {
    const message =
      payload.error ??
      payload.message ??
      (response.status === 429
        ? "You've hit the free scan limit for now. Try again in a minute."
        : "Scan failed. Check the URL and try again.");

    throw new ScanError(message, response.status, response.status === 429);
  }

  return payload as ScanResponse & { shareId: string };
}
