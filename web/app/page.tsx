import Link from 'next/link'

const FEATURES = [
  {
    title: 'mistier_detector',
    body: 'Diffs access frequency against current tier. Flags hot-tier objects with cold access, computes the exact monthly delta net of retrieval and request cost.',
  },
  {
    title: 'snapshot_bloat_scan',
    body: 'Walks every snapshot chain and backup set. Surfaces redundant, stale, and orphaned snapshots with the dollar figure recovered by pruning each one.',
  },
  {
    title: 'orphan_finder',
    body: 'Detached volumes, zero-read buckets, incomplete multipart uploads, snapshots with a dead source. Risk-rated, cost attributed, nothing guessed.',
  },
  {
    title: 'retention_reconciler',
    body: 'Declares retention policy per scope, diffs it against actual asset age and tier. Flags over-retention and coverage gaps as a report, not a hunch.',
  },
  {
    title: 'lifecycle_modeler',
    body: 'Build candidate transition/expiration rules, simulate against your inventory, export provider-ready lifecycle config. Read-only until you apply it.',
  },
  {
    title: 'recovery_worksheet',
    body: 'Every finding becomes a ranked row: savings, effort, risk. Assign an owner, set status, ship it. One number at the top tracks total recoverable.',
  },
  {
    title: 'realized_savings',
    body: 'Mark actions done, capture realized vs modeled. Run-rate and variance per cycle, so the number on the worksheet holds up in a budget review.',
  },
  {
    title: 'recovery_cycles',
    body: 'Group actions into quarterly programs with a target dollar figure, a progress board, and cycle-over-cycle trend.',
  },
  {
    title: 'forecast_and_dashboards',
    body: 'KPIs, spend/recoverable breakdown, trend charts, scenario forecasts: low-risk-only, top-20, or full program.',
  },
]

const LIFECYCLE_SNIPPET = `# generated from mistier_detector findings — apply with your provider CLI
rule:
  id: std-to-ia-to-glacier
  scope: s3://acct-9182-prod-logs/*
  transitions:
    - after_days: 30
      target_tier: STANDARD_IA
      condition: access_count_30d < 2
    - after_days: 90
      target_tier: GLACIER
      condition: access_count_90d == 0
    - after_days: 365
      action: EXPIRE
  exclude:
    - tag: retention-lock=true
  dry_run: true
  est_monthly_delta_usd: -412.30`

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-bold text-lime-400 font-mono">storage-tier-recovery-desk</span>
        <div className="flex items-center gap-3 sm:gap-5">
          <Link href="/pricing" className="text-sm text-zinc-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-zinc-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-lime-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-400">Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-lime-500/30 bg-lime-500/10 px-3 py-1 font-mono text-xs font-medium text-lime-300">
            read-only · no mutation until you apply it
          </span>
          <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-6xl">
            Your storage bill has dead weight.<br /><span className="text-lime-400">We find the exact bytes.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            Point it at your storage telemetry. Get a ranked worksheet of mis-tiered objects, snapshot sprawl, orphaned volumes, and
            over-retained data, each row priced to the dollar, sourced from your pricing book, not a rough estimate.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="rounded-lg bg-lime-500 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-lime-400">
              Start recovering spend
            </Link>
            <Link href="/auth/sign-in" className="rounded-lg border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">
              Sign in
            </Link>
          </div>
          <p className="mt-4 font-mono text-xs text-zinc-600">deterministic math · every dollar reproducible from inputs + pricing book · zero writes to your storage</p>
        </div>

        <div className="mt-16 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
            <span className="font-mono text-xs text-zinc-500">lifecycle.yaml — output of lifecycle_modeler</span>
            <span className="font-mono text-xs text-lime-400">dry_run: true</span>
          </div>
          <pre className="p-4 font-mono text-xs leading-relaxed text-zinc-300 sm:text-sm">
            <code>{LIFECYCLE_SNIPPET}</code>
          </pre>
        </div>
      </section>

      {/* Problem */}
      <section className="border-t border-zinc-800 bg-zinc-900/30 px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">15-40% of storage spend is recoverable waste</h2>
          <p className="mt-4 text-zinc-400">
            On large estates, storage is routinely a top-three line item. The native cost explorer shows you an aggregate number.
            It does not produce a per-action row a human can check off. That worksheet is the gap this tool fills.
          </p>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['mistier', 'Hot-tier objects with cold access that belong in Infrequent Access, Glacier, or archive.'],
              ['snapshot_sprawl', 'Chains and backup sets that accumulate forever with carrying cost nobody attributes.'],
              ['orphaned', 'Detached volumes, zero-read buckets, silent multipart uploads billing for nothing.'],
              ['over_retention', 'Data kept past its declared policy, or with no policy governing it at all.'],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
                <h3 className="font-mono text-sm font-semibold text-lime-300">{t}</h3>
                <p className="mt-2 text-sm text-zinc-400">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">Nine detectors, one worksheet</h2>
            <p className="mx-auto mt-3 max-w-2xl text-zinc-400">
              Every detector writes into the same ranked worksheet, tracked quarter over quarter against realized savings.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 transition-colors hover:border-lime-500/40">
                <h3 className="font-mono text-base font-semibold text-zinc-100">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-zinc-800 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Seed a sample estate, no real account needed</h2>
          <p className="mt-3 text-zinc-400">
            The built-in seeder generates a multi-account, multi-provider storage estate so you can run every detector and the full
            worksheet workflow before connecting anything real. All features are free.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="rounded-lg bg-lime-500 px-6 py-3 text-sm font-semibold text-zinc-950 hover:bg-lime-400">
              Create your free account
            </Link>
            <Link href="/pricing" className="rounded-lg border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center font-mono text-sm text-zinc-600">
        <p>storage-tier-recovery-desk — cost recovery for mis-tiered, orphaned, and over-retained storage</p>
      </footer>
    </main>
  )
}
