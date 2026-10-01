import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ScanResults from "@/components/ScanResults";
import { getScanResult } from "@/lib/scan-store";
import Footer from "@/components/Footer";

interface ScanPageProps {
  params: Promise<{ id: string }>;
}

function getReportTitle(url: string): string {
  let projectName: string;
  try {
    const target = new URL(url);
    const segments = target.pathname.split("/").filter(Boolean);
    projectName = (segments[segments.length - 1] || target.hostname).replace(/\.git$/i, "");
  } catch {
    projectName = url.split(/[/?#]/).filter(Boolean).pop()?.replace(/\.git$/i, "") || "Project";
  }

  return `ShipOrNah Security Report for ${projectName}`;
}

export async function generateMetadata({ params }: ScanPageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await getScanResult(id);

  if (!result) {
    return {
      title: "Scan not found — ShipOrNah",
      description: "This security report link is invalid or corrupted.",
    };
  }

  const title = `Security Score: ${result.healthScore}/100 — ${result.target.url}`;
  const description = `${result.summary.critical} critical, ${result.summary.high} high, and ${result.summary.medium} medium findings from a ShipOrNah security scan.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "ShipOrNah",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ScanPage({ params }: ScanPageProps) {
  const { id } = await params;
  const result = await getScanResult(id);

  if (!result) {
    notFound();
  }

  const reportTitle = getReportTitle(result.target.url);
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const shareUrl = `${protocol}://${host}/scan/${id}`;

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link
            href="/"
            className="font-mono text-2xl tracking-tight text-zinc-300 transition hover:text-white"
          >
            ShipOr<span className="text-emerald-400">Nah</span>
          </Link>
          <Link
            href="/"
            className="shrink-0 rounded-sm bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            Scan Again
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <ScanResults result={result} reportTitle={reportTitle} shareUrl={shareUrl} />
      </main>

      <section className="border-t border-zinc-800 px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-200">Built something with AI?</p>
            <p className="mt-1 text-sm text-zinc-500">
              Scan your repo for free — same checks, shareable report.
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 rounded-sm bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            Scan your own repo
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
