"use client";

import { useCallback, useState } from "react";
import { renderReportImage, reportImageFilename } from "@/lib/report/image";
import type { ScanResponse } from "@/lib/scanner/types";

interface ShareActionsProps {
  shareUrl: string;
  title: string;
  result: ScanResponse;
}

const tooltipClass =
  "pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-sm border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

const iconButtonClass =
  "cursor-pointer rounded-sm border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white";

export default function ShareActions({ shareUrl, title, result }: ShareActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers
      const input = document.createElement("input");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  const handleShare = useCallback(async () => {
    if (typeof navigator.share !== "function") {
      await handleCopy();
      return;
    }

    try {
      await navigator.share({ title, url: shareUrl });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      await handleCopy();
    }
  }, [handleCopy, shareUrl, title]);

  const handleDownload = useCallback(async () => {
    try {
      const blob = await renderReportImage(result, { shareUrl });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = reportImageFilename(result);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      // Canvas unsupported or the image couldn't be created; nothing useful to show here.
    }
  }, [result, shareUrl]);

  return (
    <div className="flex flex-wrap gap-4">
      <span className="group relative inline-flex">
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copied ? "Report link copied" : "Copy report link"}
          className={iconButtonClass}
        >
          {copied ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m12 15 2 2 4-4" />
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
          )}
        </button>
        <span role="tooltip" className={tooltipClass}>
          {copied ? "Copied!" : "Copy Report Link"}
        </span>
      </span>

      <span className="group relative inline-flex">
        <button
          type="button"
          onClick={() => void handleShare()}
          aria-label="Share report"
          className={iconButtonClass}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
            <path d="m21 3-9 9" />
            <path d="M15 3h6v6" />
          </svg>
        </button>
        <span role="tooltip" className={tooltipClass}>
          Share Report
        </span>
      </span>

      <span className="group relative inline-flex">
        <button
          type="button"
          onClick={() => void handleDownload()}
          aria-label="Download report image"
          className={iconButtonClass}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
          </svg>
        </button>
        <span role="tooltip" className={tooltipClass}>
          Download Report
        </span>
      </span>
    </div>
  );
}
