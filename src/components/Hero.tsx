"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScanError, runScan } from "@/lib/scan-client";
import { detectScanType, normalizeUrl, scanTypeLabel } from "@/lib/scan-url";
import { posthog } from "posthog-js";

const LOADING_MESSAGES = [
    "Fetching files…",
    "Checking for exposed secrets…",
    "Auditing database permissions…",
    "Analyzing API routes…",
];

type ScanState = "idle" | "loading" | "error";

export default function Hero() {
    const router = useRouter();
    const [url, setUrl] = useState("");
    const [state, setState] = useState<ScanState>("idle");
    const [messageIndex, setMessageIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isRateLimited, setIsRateLimited] = useState(false);

    const scanType = url.trim() ? detectScanType(url) : null;

    useEffect(() => {
        if (state !== "loading") return;

        const interval = setInterval(() => {
            setMessageIndex((index) => (index + 1) % LOADING_MESSAGES.length);
        }, 1500);

        return () => clearInterval(interval);
    }, [state]);

    const handleScan = useCallback(async () => {
        const normalized = normalizeUrl(url);

        if (!normalized) {
            setError("Paste a GitHub repo URL to scan.");
            setState("error");
            return;
        }

        const type = detectScanType(normalized);

        if (!type) {
            setError("Only GitHub repo URLs are supported.");
            setState("error");
            return;
        }

        // User submitted a valid scan
        posthog.capture("repo_scan_started", {
            scan_type: type,
        });

        setState("loading");
        setError(null);
        setIsRateLimited(false);
        setMessageIndex(0);

        try {
            const data = await runScan(type, normalized);

            // Scan actually completed successfully
            posthog.capture("repo_scan_completed", {
                scan_type: type,
            });

            router.push(`/scan/${data.shareId}`);
        } catch (err) {
            posthog.capture("repo_scan_failed", {
                scan_type: type,
                rate_limited:
                    err instanceof ScanError ? err.isRateLimited : false,
            });

            if (err instanceof ScanError) {
                setError(err.message);
                setIsRateLimited(err.isRateLimited);
            } else {
                setError("Something went wrong. Check your connection and try again.");
            }

            setState("error");
        }
    }, [url, router]);

    const handleRetry = () => {
        setState("idle");
        setError(null);
        setIsRateLimited(false);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && state !== "loading") {
            void handleScan();
        }
    };

    return (
        <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="space-y-8">
                <div className="space-y-4">
                    <h1 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-50 sm:text-5xl sm:leading-tight">
                        Your AI-generated app might be leaking data right now.
                        <span className="block text-zinc-400">Check for free.</span>
                    </h1>
                    <p className="max-w-xl text-sm leading-relaxed text-zinc-500 sm:text-base">
                        Built with Lovable, Bolt, Cursor, Claude Code, Codex or v0? Paste your GitHub repo URL.
                        We scan for exposed API keys, missing Supabase RLS, and unprotected
                        routes.
                    </p>
                </div>

                <div className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <div className="relative flex-1">
                            <input
                                type="url"
                                value={url}
                                onChange={(event) => setUrl(event.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="https://github.com/you/repo"
                                disabled={state === "loading"}
                                className="w-full rounded-sm border border-zinc-700 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-60"
                            />
                            {scanType && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                                    {scanTypeLabel(scanType)}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => void handleScan()}
                            disabled={state === "loading" || !url.trim()}
                            className="rounded-sm bg-emerald-600 px-6 py-3 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {state === "loading" ? "Scanning…" : "Scan now"}
                        </button>
                    </div>

                    {state === "loading" && (
                        <div className="flex items-center gap-3 rounded-sm border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                            <span className="inline-block h-4 w-4 animate-spin rounded-sm border-2 border-zinc-600 border-t-emerald-400" />
                            <p className="font-mono text-sm text-zinc-400">
                                {LOADING_MESSAGES[messageIndex]}
                            </p>
                        </div>
                    )}

                    {state === "error" && error && (
                        <div
                            className={`rounded-sm border px-4 py-4 ${isRateLimited
                                ? "border-amber-500/30 bg-amber-500/5"
                                : "border-red-500/30 bg-red-500/5"
                                }`}
                        >
                            <p
                                className={`text-sm ${isRateLimited ? "text-amber-300" : "text-red-300"}`}
                            >
                                {error}
                            </p>
                            <button
                                type="button"
                                onClick={handleRetry}
                                className="mt-3 rounded-sm border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                            >
                                Try again
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}