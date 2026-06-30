import Link from 'next/link'

const FEATURES = [
  {
    title: 'Mis-Tier Detector',
    body: 'Find hot-tier objects with cold access patterns and compute the exact monthly delta of re-tiering each one, net of retrieval and request cost.',
  },
  {
    title: 'Snapshot & Backup Bloat',
    body: 'Attribute carrying cost to every snapshot and chain. Surface redundant, stale, and orphaned snapshots with the dollars recovered from pruning them.',
  },
  {
    title: 'Orphan & Abandoned Finder',
    body: 'Detached volumes, zero-read buckets, incomplete multipart uploads, and snapshots whose source is gone. Risk-rated, full cost recoverable.',
  },
  {
    title: 'Retention Reconciler',
    body: 'Define retention policies per scope and reconcile actual asset age and tier against them. Flag over-retention and policy gaps with coverage reporting.',
  },
  {
    title: 'Lifecycle Modeler',
    body: 'Build candidate transition and expiration rules, simulate them against your inventory, and export provider-ready lifecycle JSON without mutating storage.',
  },
  {
    title: 'Recovery Worksheet',
    body: 'Every finding becomes a ranked line with savings, effort, and risk. Assign owners, set status, and track the headline recoverable number.',
  },
  {
    title: 'Realized-Savings Tracker',
    body: 'Mark actions done and capture realized vs modeled savings. Run-rate, variance, and per-cycle rollups make the program defensible.',
  },
  {
    title: 'Recovery Cycles',
    body: 'Group actions into quarterly programs with target dollars, progress boards, and cycle-over-cycle recovery trends.',
  },
  {
    title: 'Dashboards & Forecast',
    body: 'Executive KPIs, spend and recoverable breakdowns, trend charts, and scenario forecasts: low-risk, top-20, or the full program.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-bold text-cyan-400">StorageTierRecoveryDesk</span>
        <div className="flex items-center gap-3 sm:gap-5">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500">Get Started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
          Read-only storage cost recovery
        </span>
        <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-6xl">
          Find the money trapped in your <span className="text-cyan-400">cloud storage.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          StorageTierRecoveryDesk turns raw storage telemetry into a defensible, ranked recovery worksheet. Mis-tiered objects, snapshot
          sprawl, orphaned volumes, and over-retention become exact dollars recoverable per action, scored by savings, effort, and risk.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-600 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-500">
            Start recovering spend
          </Link>
          <Link href="/auth/sign-in" className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-600">Deterministic math. Every dollar reproducible from inputs and the pricing book. We never touch your storage.</p>
      </section>

      {/* Problem */}
      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">15-40% of your storage spend is recoverable waste</h2>
          <p className="mt-4 text-slate-400">
            On large estates, storage is routinely a top-three line item. Native cost explorers show you the aggregate bill, but they never
            produce a per-action dollar figure a human can work through and check off. That worksheet is the gap.
          </p>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Mis-tiering', 'Hot-tier objects with cold access patterns that belong in Infrequent Access, Glacier, or archive.'],
              ['Snapshot sprawl', 'Chains and backup sets that accumulate forever with carrying cost nobody attributes.'],
              ['Orphaned assets', 'Detached volumes, zero-read buckets, and silent multipart uploads billing for nothing.'],
              ['Over-retention', 'Data kept far past its declared policy, or with no policy governing it at all.'],
            ].map(([t, b]) => (
              <div key={t} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <h3 className="text-sm font-semibold text-cyan-300">{t}</h3>
                <p className="mt-2 text-sm text-slate-400">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-2xl font-bold sm:text-3xl">A full recovery program, not a one-off audit</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-400">
              Every detector feeds one ranked worksheet, tracked quarter over quarter with realized savings.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900 p-6 transition-colors hover:border-cyan-500/40">
                <h3 className="text-base font-semibold text-slate-100">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Try it on a sample estate in one click</h2>
          <p className="mt-3 text-slate-400">
            A built-in seeder generates a realistic multi-account, multi-provider storage estate so you can explore the whole workflow
            before connecting a real account. All features are free.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/auth/sign-up" className="rounded-lg bg-cyan-600 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-500">
              Create your free account
            </Link>
            <Link href="/pricing" className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800">
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>StorageTierRecoveryDesk — storage cost recovery analysis desk</p>
      </footer>
    </main>
  )
}
