'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import CommandPalette, { type CommandItem } from './CommandPalette'

interface NavItem {
  label: string
  href: string
  key: string
}
interface NavSection {
  title: string
  items: NavItem[]
}

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard', key: 'DB' }],
  },
  {
    title: 'Estate',
    items: [
      { label: 'Accounts', href: '/dashboard/accounts', key: 'AC' },
      { label: 'Ingest', href: '/dashboard/ingest', key: 'IN' },
      { label: 'Inventory', href: '/dashboard/inventory', key: 'IV' },
      { label: 'Access Patterns', href: '/dashboard/access', key: 'AP' },
    ],
  },
  {
    title: 'Detectors',
    items: [
      { label: 'Mis-Tier', href: '/dashboard/mistier', key: 'MT' },
      { label: 'Snapshots & Backups', href: '/dashboard/snapshots', key: 'SB' },
      { label: 'Orphans', href: '/dashboard/orphans', key: 'OR' },
      { label: 'Retention', href: '/dashboard/retention', key: 'RT' },
      { label: 'Lifecycle Modeler', href: '/dashboard/lifecycle', key: 'LC' },
    ],
  },
  {
    title: 'Recovery',
    items: [
      { label: 'Worksheet', href: '/dashboard/worksheet', key: 'WS' },
      { label: 'Cycles', href: '/dashboard/cycles', key: 'CY' },
      { label: 'Realized Savings', href: '/dashboard/realized', key: 'RS' },
      { label: 'Forecast', href: '/dashboard/forecast', key: 'FC' },
    ],
  },
  {
    title: 'Analyze',
    items: [
      { label: 'Analysis Runs', href: '/dashboard/analysis', key: 'AR' },
      { label: 'Allocation', href: '/dashboard/allocation', key: 'AL' },
      { label: 'Pricing Book', href: '/dashboard/pricing', key: 'PB' },
      { label: 'Alerts', href: '/dashboard/alerts', key: 'AT' },
      { label: 'Reports', href: '/dashboard/reports', key: 'RP' },
      { label: 'Activity', href: '/dashboard/activity', key: 'AY' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Settings', href: '/dashboard/settings', key: 'ST' }],
  },
]

const COMMAND_ITEMS: CommandItem[] = SECTIONS.flatMap((s) =>
  s.items.map((i) => ({ label: i.label, href: i.href, group: s.title }))
)

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
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex items-center gap-3 text-zinc-400">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-lime-400" />
          Loading workspace...
        </div>
      </div>
    )
  }

  const allItems = SECTIONS.flatMap((s) => s.items)

  const rail = (
    <nav className="flex h-full flex-col items-center gap-1 py-4">
      <Link
        href="/dashboard"
        className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-lime-500/15 text-sm font-bold text-lime-300"
        title="StorageTierRecoveryDesk"
      >
        ▤
      </Link>
      {allItems.map((item) => {
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            title={item.label}
            className={`flex h-9 w-9 items-center justify-center rounded-lg font-mono text-[10px] font-semibold transition-colors ${
              active ? 'bg-lime-500/10 text-lime-300' : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-100'
            }`}
          >
            {item.key}
          </Link>
        )
      })}
    </nav>
  )

  const mobileMenu = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime-500/15 text-lime-300">▤</span>
        <span className="text-sm font-bold tracking-tight text-zinc-100">StorageTierRecoveryDesk</span>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{section.title}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                      active ? 'bg-lime-500/10 font-medium text-lime-300' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
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
    <div className="flex min-h-screen bg-zinc-950">
      <CommandPalette items={COMMAND_ITEMS} />

      {/* Minimal desktop rail */}
      <aside className="hidden w-14 shrink-0 border-r border-zinc-800 bg-zinc-900/50 lg:block">{rail}</aside>

      {/* Mobile drawer (full nav, since rail icons are terse) */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-zinc-950/70" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-zinc-800 bg-zinc-900">{mobileMenu}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setOpen(true)}
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white lg:hidden"
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-zinc-300">{workspace}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
              className="hidden items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-300 sm:flex"
            >
              <span>Search routes</span>
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
            </button>
            <button
              onClick={signOut}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
