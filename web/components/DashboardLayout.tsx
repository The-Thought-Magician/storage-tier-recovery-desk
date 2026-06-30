'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

interface NavItem {
  label: string
  href: string
}
interface NavSection {
  title: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Estate',
    items: [
      { label: 'Accounts', href: '/dashboard/accounts' },
      { label: 'Ingest', href: '/dashboard/ingest' },
      { label: 'Inventory', href: '/dashboard/inventory' },
      { label: 'Access Patterns', href: '/dashboard/access' },
    ],
  },
  {
    title: 'Detectors',
    items: [
      { label: 'Mis-Tier', href: '/dashboard/mistier' },
      { label: 'Snapshots & Backups', href: '/dashboard/snapshots' },
      { label: 'Orphans', href: '/dashboard/orphans' },
      { label: 'Retention', href: '/dashboard/retention' },
      { label: 'Lifecycle Modeler', href: '/dashboard/lifecycle' },
    ],
  },
  {
    title: 'Recovery',
    items: [
      { label: 'Worksheet', href: '/dashboard/worksheet' },
      { label: 'Cycles', href: '/dashboard/cycles' },
      { label: 'Realized Savings', href: '/dashboard/realized' },
      { label: 'Forecast', href: '/dashboard/forecast' },
    ],
  },
  {
    title: 'Analyze',
    items: [
      { label: 'Analysis Runs', href: '/dashboard/analysis' },
      { label: 'Allocation', href: '/dashboard/allocation' },
      { label: 'Pricing Book', href: '/dashboard/pricing' },
      { label: 'Alerts', href: '/dashboard/alerts' },
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Activity', href: '/dashboard/activity' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Settings', href: '/dashboard/settings' }],
  },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(true)
  const [workspace, setWorkspace] = useState('Workspace')

  useEffect(() => {
    let active = true
    ;(async () => {
      const s = await authClient.getSession()
      if (!active) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      const u = s.data.user as { name?: string; email?: string }
      setWorkspace(u.name || u.email || 'Workspace')
      setChecking(false)
    })()
    return () => {
      active = false
    }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(href + '/')

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
          Loading workspace...
        </div>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-300">▤</span>
        <span className="text-sm font-bold tracking-tight text-slate-100">StorageTierRecoveryDesk</span>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{section.title}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-cyan-500/10 font-medium text-cyan-300'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900/50 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/70" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-800 bg-slate-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-slate-300">{workspace}</span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-700"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
