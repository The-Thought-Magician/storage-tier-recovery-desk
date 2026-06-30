'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const FREE_FEATURES = [
  'All cloud accounts and multi-account rollup',
  'Storage inventory ingestion + sample-data seeder',
  'Access-pattern enrichment and temperature heatmap',
  'Editable, versioned pricing book',
  'Mis-tier, snapshot, orphan & retention detectors',
  'Lifecycle modeler with provider-ready export',
  'Ranked recovery worksheet + cycles',
  'Realized-savings tracking and forecasts',
  'Dashboards, reports, CSV/JSON exports',
  'Tag-based cost allocation, alerts, saved views',
  'Activity audit trail and notifications',
]

export default function Pricing() {
  const [plan, setPlan] = useState<string | null>(null)
  const [stripeEnabled, setStripeEnabled] = useState(false)

  useEffect(() => {
    let active = true
    api
      .getBillingPlan()
      .then((res) => {
        if (!active) return
        const name = res?.plan?.name ?? (res?.subscription?.plan_id === 'pro' ? 'Pro' : 'Free')
        setPlan(name)
        setStripeEnabled(!!res?.stripeEnabled)
      })
      .catch(() => {
        /* unauthenticated visitors simply see no current-plan badge */
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold text-cyan-400">StorageTierRecoveryDesk</Link>
        <div className="flex items-center gap-5">
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">Sign In</Link>
          <Link href="/auth/sign-up" className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500">Get Started</Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Simple pricing</h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-400">
          Every feature is free while StorageTierRecoveryDesk is in its growth phase. The Pro plan is a scaffold for future paid tiers and
          activates only when billing is configured.
        </p>
        {plan && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
            Your current plan: {plan}
          </p>
        )}

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {/* Free */}
          <div className="rounded-2xl border border-cyan-500/40 bg-slate-900 p-8 text-left shadow-lg shadow-cyan-500/5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Free</h2>
              <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300">All features</span>
            </div>
            <div className="mt-4 text-4xl font-black">
              $0<span className="text-base font-medium text-slate-500">/mo</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">Everything in StorageTierRecoveryDesk, for every signed-in workspace.</p>
            <ul className="mt-6 space-y-2.5">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="mt-0.5 text-cyan-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/auth/sign-up"
              className="mt-8 block rounded-lg bg-cyan-600 py-3 text-center text-sm font-semibold text-white hover:bg-cyan-500"
            >
              Get started free
            </Link>
          </div>

          {/* Pro */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-200">Pro</h2>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-400">
                {stripeEnabled ? 'Available' : 'Coming soon'}
              </span>
            </div>
            <div className="mt-4 text-4xl font-black text-slate-300">
              $0<span className="text-base font-medium text-slate-500">/mo today</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              A scaffold for future team and scale tiers. Checkout, portal, and webhooks return a graceful unavailable response until Stripe
              is configured.
            </p>
            <ul className="mt-6 space-y-2.5">
              {['Everything in Free', 'Priority support (planned)', 'Higher ingestion limits (planned)', 'SSO and team roles (planned)'].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-400">
                  <span className="mt-0.5 text-slate-600">○</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              disabled
              className="mt-8 block w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-800 py-3 text-center text-sm font-semibold text-slate-500"
            >
              {stripeEnabled ? 'Upgrade from Settings' : 'Not yet available'}
            </button>
          </div>
        </div>

        <p className="mt-10 text-sm text-slate-500">
          Manage billing anytime from your workspace <Link href="/dashboard/settings" className="text-cyan-400 hover:text-cyan-300">settings</Link>.
        </p>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>StorageTierRecoveryDesk — storage cost recovery analysis desk</p>
      </footer>
    </main>
  )
}
