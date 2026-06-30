'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Asset {
  id: string
  account_id: string
  external_id: string | null
  name: string
  asset_type: string
  provider: string
  region: string | null
  current_tier: string
  size_bytes: number
  object_count: number | null
  monthly_cost: number
  attached: boolean | null
  tags: Record<string, string> | null
  metadata: Record<string, unknown> | null
  asset_created_at: string | null
  last_modified_at: string | null
  created_at: string
}

interface Account {
  id: string
  name: string
  provider: string
}

interface SavedView {
  id: string
  name: string
  scope: string
  filters: Record<string, unknown>
  is_default: boolean | null
}

const ASSET_TYPES = ['bucket', 'volume', 'snapshot', 'backup', 'multipart']
const TIERS = ['hot', 'warm', 'cold', 'archive', 'deep-archive']
const TEMPERATURES = ['hot', 'warm', 'cold', 'frozen', 'never']

const tierTone: Record<string, 'rose' | 'amber' | 'blue' | 'cyan' | 'slate'> = {
  hot: 'rose',
  warm: 'amber',
  cold: 'blue',
  archive: 'cyan',
  'deep-archive': 'slate',
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0)
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`
}

interface Filters {
  account_id: string
  asset_type: string
  tier: string
  temperature: string
}

const EMPTY_FILTERS: Filters = { account_id: '', asset_type: '', tier: '', temperature: '' }

export default function InventoryPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [views, setViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [activeView, setActiveView] = useState<string | null>(null)

  const [saveOpen, setSaveOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  const [viewDefault, setViewDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  const accountName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of accounts) m[a.id] = a.name
    return m
  }, [accounts])

  async function loadAssets(f: Filters) {
    const params: Record<string, unknown> = {}
    if (f.account_id) params.account_id = f.account_id
    if (f.asset_type) params.asset_type = f.asset_type
    if (f.tier) params.tier = f.tier
    if (f.temperature) params.temperature = f.temperature
    const rows = await api.getAssets(params)
    setAssets(Array.isArray(rows) ? rows : [])
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [accs, vws] = await Promise.all([api.getAccounts(), api.getViews({ scope: 'inventory' })])
        if (!active) return
        setAccounts(Array.isArray(accs) ? accs : [])
        const viewList: SavedView[] = Array.isArray(vws) ? vws : []
        setViews(viewList)
        const def = viewList.find((v) => v.is_default)
        const startFilters = def ? { ...EMPTY_FILTERS, ...(def.filters as Partial<Filters>) } : EMPTY_FILTERS
        if (def) {
          setActiveView(def.id)
          setFilters(startFilters)
        }
        await loadAssets(startFilters)
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load inventory')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function applyFilters(next: Filters) {
    setFilters(next)
    setActiveView(null)
    setLoading(true)
    setError(null)
    try {
      await loadAssets(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }

  async function applyView(v: SavedView) {
    const next = { ...EMPTY_FILTERS, ...(v.filters as Partial<Filters>) }
    setFilters(next)
    setSearch('')
    setActiveView(v.id)
    setLoading(true)
    setError(null)
    try {
      await loadAssets(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load inventory')
    } finally {
      setLoading(false)
    }
  }

  async function saveView() {
    if (!viewName.trim()) return
    setSaving(true)
    try {
      const created = await api.createView({
        name: viewName.trim(),
        scope: 'inventory',
        filters: filters as unknown as Record<string, unknown>,
        is_default: viewDefault,
      })
      const refreshed = await api.getViews({ scope: 'inventory' })
      setViews(Array.isArray(refreshed) ? refreshed : [])
      if (created?.id) setActiveView(created.id)
      setSaveOpen(false)
      setViewName('')
      setViewDefault(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save view')
    } finally {
      setSaving(false)
    }
  }

  async function removeView(id: string) {
    try {
      await api.deleteView(id)
      setViews((prev) => prev.filter((v) => v.id !== id))
      if (activeView === id) setActiveView(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete view')
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return assets
    return assets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.external_id ?? '').toLowerCase().includes(q) ||
        (a.region ?? '').toLowerCase().includes(q) ||
        a.provider.toLowerCase().includes(q),
    )
  }, [assets, search])

  const totals = useMemo(() => {
    let cost = 0
    let bytes = 0
    for (const a of filtered) {
      cost += a.monthly_cost || 0
      bytes += a.size_bytes || 0
    }
    return { cost, bytes, count: filtered.length }
  }, [filtered])

  const hasActiveFilters = filters.account_id || filters.asset_type || filters.tier || filters.temperature

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Storage Inventory</h1>
          <p className="mt-1 text-sm text-slate-500">Every storage asset across your cloud accounts, with tier, size, and monthly cost.</p>
        </div>
        <Button variant="secondary" onClick={() => setSaveOpen(true)}>
          Save current view
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Assets" value={totals.count.toLocaleString()} tone="cyan" />
        <Stat label="Total size" value={fmtBytes(totals.bytes)} />
        <Stat label="Monthly cost" value={fmtUsd(totals.cost)} tone="amber" hint="Sum across visible assets" />
      </div>

      {views.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Saved views</span>
          {views.map((v) => (
            <span
              key={v.id}
              className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                activeView === v.id
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                  : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600'
              }`}
            >
              <button onClick={() => applyView(v)} className="font-medium">
                {v.name}
                {v.is_default ? ' ★' : ''}
              </button>
              <button
                onClick={() => removeView(v.id)}
                className="text-slate-500 hover:text-rose-400"
                aria-label={`Delete view ${v.name}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="md:col-span-1">
              <label className="mb-1 block text-xs text-slate-500">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, ARN, region…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Account</label>
              <select
                value={filters.account_id}
                onChange={(e) => applyFilters({ ...filters, account_id: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Asset type</label>
              <select
                value={filters.asset_type}
                onChange={(e) => applyFilters({ ...filters, asset_type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All types</option>
                {ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Tier</label>
              <select
                value={filters.tier}
                onChange={(e) => applyFilters({ ...filters, tier: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All tiers</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Temperature</label>
              <select
                value={filters.temperature}
                onChange={(e) => applyFilters({ ...filters, temperature: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="">All temps</option>
                {TEMPERATURES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {hasActiveFilters && (
            <div className="mt-3">
              <button
                onClick={() => applyFilters(EMPTY_FILTERS)}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                Clear filters
              </button>
            </div>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading inventory…" />
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center text-sm text-rose-400">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No storage assets"
                description={
                  hasActiveFilters || search
                    ? 'No assets match the current filters. Adjust or clear them to see more.'
                    : 'Ingest a CSV or seed sample data from the Ingest page to populate your inventory.'
                }
                action={
                  hasActiveFilters || search ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('')
                        applyFilters(EMPTY_FILTERS)
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Link href="/dashboard/ingest">
                      <Button>Go to Ingest</Button>
                    </Link>
                  )
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Asset</TH>
                  <TH>Account</TH>
                  <TH>Type</TH>
                  <TH>Tier</TH>
                  <TH className="text-right">Size</TH>
                  <TH className="text-right">Objects</TH>
                  <TH className="text-right">Monthly cost</TH>
                  <TH>Tags</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((a) => (
                  <TR key={a.id} className="cursor-default">
                    <TD>
                      <Link href={`/dashboard/inventory/${a.id}`} className="font-medium text-cyan-300 hover:text-cyan-200">
                        {a.name}
                      </Link>
                      <div className="text-xs text-slate-600">{a.external_id || a.region || a.provider}</div>
                    </TD>
                    <TD>{accountName[a.account_id] || '—'}</TD>
                    <TD>
                      <span className="capitalize">{a.asset_type}</span>
                    </TD>
                    <TD>
                      <Badge tone={tierTone[a.current_tier] ?? 'slate'}>{a.current_tier}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{fmtBytes(a.size_bytes)}</TD>
                    <TD className="text-right tabular-nums">{(a.object_count ?? 0).toLocaleString()}</TD>
                    <TD className="text-right tabular-nums text-amber-300">{fmtUsd(a.monthly_cost)}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(a.tags ?? {})
                          .slice(0, 3)
                          .map(([k, v]) => (
                            <span key={k} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                              {k}:{v}
                            </span>
                          ))}
                        {Object.keys(a.tags ?? {}).length === 0 && <span className="text-xs text-slate-600">untagged</span>}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save inventory view"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveView} disabled={saving || !viewName.trim()}>
              {saving ? 'Saving…' : 'Save view'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Saves the current filter set (account, type, tier, temperature) so you can re-apply it in one click.
          </p>
          <div>
            <label className="mb-1 block text-xs text-slate-500">View name</label>
            <input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="e.g. Cold buckets on AWS"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={viewDefault} onChange={(e) => setViewDefault(e.target.checked)} className="accent-cyan-500" />
            Make this my default view
          </label>
          <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-500">
            Current filters:{' '}
            {hasActiveFilters
              ? [
                  filters.account_id && `account=${accountName[filters.account_id] || filters.account_id}`,
                  filters.asset_type && `type=${filters.asset_type}`,
                  filters.tier && `tier=${filters.tier}`,
                  filters.temperature && `temp=${filters.temperature}`,
                ]
                  .filter(Boolean)
                  .join(', ')
              : 'none (all assets)'}
          </div>
        </div>
      </Modal>
    </div>
  )
}
