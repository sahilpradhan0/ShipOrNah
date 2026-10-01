import Link from "next/link";

function Illustration() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 360 260"
      className="h-auto w-72 sm:w-80"
      aria-hidden="true"
    >
      <defs>
      <radialGradient id="nf-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor="#10b981" stopOpacity="0.28"/>
      <stop offset="100%" stopColor="#10b981" stopOpacity="0"/>
      </radialGradient>
      <linearGradient id="nf-card" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#1c1c20"/>
      <stop offset="100%" stopColor="#111113"/>
      </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="180" cy="238" rx="112" ry="9" fill="#10b981" fillOpacity="0.09"/>

      {/* back card, tilted */}
      <g transform="rotate(-7 170 130)">
      <rect x="80" y="30" width="170" height="196" rx="16" fill="#18181b" stroke="#27272a" strokeWidth="1.5"/>
      </g>

      {/* main report card (dashed = missing) */}
      <rect x="98" y="20" width="176" height="204" rx="16" fill="url(#nf-card)" stroke="#52525b" strokeWidth="1.5" strokeDasharray="7 6"/>

      {/* header row */}
      <circle cx="124" cy="48" r="5.5" fill="#34d399"/>
      <rect x="138" y="44" width="74" height="8" rx="4" fill="#3f3f46"/>
      <rect x="222" y="44" width="36" height="8" rx="4" fill="#27272a"/>

      {/* empty score ring */}
      <circle cx="186" cy="102" r="27" fill="none" stroke="#27272a" strokeWidth="8"/>
      <path d="M176 102h20" stroke="#52525b" strokeWidth="4" strokeLinecap="round"/>

      {/* skeleton findings */}
      <circle cx="122" cy="156" r="4.5" fill="#f87171"/>
      <rect x="134" y="152" width="84" height="8" rx="4" fill="#27272a"/>
      <rect x="228" y="152" width="28" height="8" rx="4" fill="#f87171" fillOpacity="0.22"/>

      <circle cx="122" cy="178" r="4.5" fill="#fbbf24"/>
      <rect x="134" y="174" width="64" height="8" rx="4" fill="#27272a"/>
      <rect x="228" y="174" width="28" height="8" rx="4" fill="#fbbf24" fillOpacity="0.22"/>

      <circle cx="122" cy="200" r="4.5" fill="#38bdf8"/>
      <rect x="134" y="196" width="74" height="8" rx="4" fill="#27272a"/>
      <rect x="228" y="196" width="28" height="8" rx="4" fill="#38bdf8" fillOpacity="0.22"/>

      {/* magnifying glass */}
      <circle cx="250" cy="168" r="78" fill="url(#nf-glow)"/>
      <line x1="281" y1="199" x2="320" y2="238" stroke="#059669" strokeWidth="13" strokeLinecap="round"/>
      <line x1="281" y1="199" x2="320" y2="238" stroke="#34d399" strokeWidth="8" strokeLinecap="round"/>
      <circle cx="250" cy="168" r="44" fill="#09090b" fillOpacity="0.72" stroke="#34d399" strokeWidth="7"/>
      <path d="M222 148a34 34 0 0 1 22-14" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="4" strokeLinecap="round"/>
      <path d="M238 160a12 12 0 1 1 17 11c-4 2.4-5 4-5 9" fill="none" stroke="#34d399" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="250" cy="195" r="3.6" fill="#34d399"/>

      {/* sparkles */}
      <circle cx="58" cy="64" r="2.5" fill="#34d399" fillOpacity="0.6"/>
      <circle cx="318" cy="78" r="3.2" fill="#38bdf8" fillOpacity="0.5"/>
      <circle cx="44" cy="176" r="3" fill="#fbbf24" fillOpacity="0.5"/>
      <path d="M312 120v10M307 125h10" stroke="#34d399" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round"/>
      <path d="M60 118v8M56 122h8" stroke="#a1a1aa" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

export default function ScanNotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Soft glow and a faded dot grid behind the content */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[38%] h-112 w-md -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-3xl motion-safe:animate-pulse" />
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: "radial-gradient(#3f3f46 1px, transparent 1px)",
            backgroundSize: "28px 28px",
            maskImage: "radial-gradient(ellipse at center, black 15%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(ellipse at center, black 15%, transparent 70%)",
          }}
        />
      </div>

      <header className="relative border-b border-zinc-800/80 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center">
          <Link
            href="/"
            className="font-mono text-2xl tracking-tight text-zinc-300 transition hover:text-white"
          >
            ShipOr<span className="text-emerald-400">Nah</span>
          </Link>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center px-4 py-14 text-center sm:py-20">
        <Illustration />

        <p className="mt-8 font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">
          404 &middot; Report not found
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
          We couldn&apos;t find that report
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-zinc-400 sm:text-base sm:leading-7">
          Scan reports are kept for 24 hours, so this one may have expired. It&apos;s also possible
          the link was cut off when it was copied.
        </p>

        <Link
          href="/"
          className="group mt-8 inline-flex items-center gap-2 rounded-sm bg-emerald-600 px-6 py-3 text-sm font-medium text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500"
        >
          Scan your repo
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-0.5"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>
        <p className="mt-3 text-xs text-zinc-600">Free, and your new report gets its own shareable link.</p>
      </main>
    </div>
  );
}
