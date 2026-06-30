'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface AllocationRow {
  key?: string
  value?: string
  label?: string
  dimension?: string
  spend?: number
  monthly_spend?: number
  recoverable?: number
  recoverable_monthly?: number
  asset_count?: number
  count?: number
}

interface AllocationResponse {
  dimension?: string
  rows?: AllocationRow[]
}

interface UntaggedAsset {
  id: string
  name?: string
  asset_type?: string
  provider?: string
  region?: string
  current_tier?: string
  monthly_cost?: number
}

interface UntaggedResponse {
  assets?: UntaggedAsset[]
  untagged_spend?: number
}

interface Tag {
  id?: string
  key?: string
  value?: string
}

const DIMENSIONS = [
  { value: 'team', label: 'Team' },
  { value: 'cost_center', label: 'Cost Center' },
  { value: 'environment', label: 'Environment' },
  { value: 'provider', label: 'Provider' },
  { value: 'account', label: 'Account' },
]

const fmtUSD = (n?: number) =>
  n == null || Number.isNaN(n)
    ? '$0'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const fmtUSD2 = (n?: number) =>
  n == null || Number.isNaN(n)
    ? '$0.00'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

function rowSpend(r: AllocationRow): number {
  return r.spend ?? r.monthly_spend ?? 0
}
function rowRecoverable(r: AllocationRow): number {
  return r.recoverable ?? r.recoverable_monthly ?? 0
}
function rowLabel(r: AllocationRow): string {
  return r.label ?? r.value ?? r.key ?? '(unassigned)'
}
function rowCount(r: AllocationRow): number {
  return r.asset_count ?? r.count ?? 0
}

export default function AllocationPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dimension, setDimension] = useState('team')

  const [rows, setRows] = useState<AllocationRow[]>([])
  const [untagged, setUntagged] = useState<UntaggedResponse>({ assets: [], untagged_spend: 0 })
  const [tags, setTags] = useState<Tag[]>([])
  const [search, setSearch] = useState('')

  const loadAllocation = async (dim: string) => {
    const alloc: AllocationResponse = await api.getAllocation({ dimension: dim })
    const r: AllocationRow[] = (alloc?.rows ?? (Array.isArray(alloc) ? alloc : [])) as AllocationRow[]
    setRows(Array.isArray(r) ? r : [])
  }

  const loadAll = async (dim: string) => {
    setLoading(true)
    setError(null)
    try {
      const [, untaggedRes, tagsRes] = await Promise.all([
        loadAllocation(dim),
        api.getUntaggedAllocation(),
        api.getTags(),
      ])
      const u = (untaggedRes ?? {}) as UntaggedResponse
      setUntagged({ assets: u.assets ?? [], untagged_spend: u.untagged_spend ?? 0 })
      setTags((Array.isArray(tagsRes) ? tagsRes : tagsRes?.tags ?? []) as Tag[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load allocation')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll(dimension)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDimensionChange = async (dim: string) => {
    setDimension(dim)
    setError(null)
    try {
      await loadAllocation(dim)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load allocation')
    }
  }

  const totals = useMemo(() => {
    const spend = rows.reduce((s, r) => s + rowSpend(r), 0)
    const recoverable = rows.reduce((s, r) => s + rowRecoverable(r), 0)
    return { spend, recoverable }
  }, [rows])

  const maxSpend = useMemo(() => Math.max(1, ...rows.map(rowSpend)), [rows])

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => rowSpend(b) - rowSpend(a)),
    [rows],
  )

  const filteredUntagged = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = untagged.assets ?? []
    if (!q) return list
    return list.filter(
      (a) =>
        (a.name ?? '').toLowerCase().includes(q) ||
        (a.asset_type ?? '').toLowerCase().includes(q) ||
        (a.provider ?? '').toLowerCase().includes(q) ||
        (a.region ?? '').toLowerCase().includes(q),
    )
  }, [untagged, search])

  const tagsByKey = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const t of tags) {
      if (!t.key) continue
      const arr = map.get(t.key) ?? []
      if (t.value) arr.push(t.value)
      map.set(t.key, arr)
    }
    return map
  }, [tags])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading allocation..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Cost Allocation</h1>
          <p className="mt-1 text-sm text-slate-500">
            Spend and recoverable savings broken down by tag dimension, plus untagged gaps.
          </p>
        </div>
        <Button variant="secondary" onClick={() => loadAll(dimension)}>
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-rose-500/30">
          <CardBody className="flex items-center justify-between">
            <span className="text-sm text-rose-300">{error}</span>
            <Button variant="secondary" onClick={() => loadAll(dimension)}>
              Retry
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={`Allocated spend (${dimension})`} value={fmtUSD(totals.spend)} />
        <Stat label="Recoverable" value={fmtUSD(totals.recoverable)} tone="green" />
        <Stat
          label="Untagged spend"
          value={fmtUSD(untagged.untagged_spend)}
          tone={untagged.untagged_spend ? 'amber' : 'default'}
          hint={`${(untagged.assets ?? []).length} assets`}
        />
      </div>

      {/* Allocation breakdown */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Allocation by dimension</h2>
            <p className="mt-0.5 text-xs text-slate-500">Choose a dimension to regroup spend.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DIMENSIONS.map((d) => (
              <button
                key={d.value}
                onClick={() => onDimensionChange(d.value)}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  dimension === d.value
                    ? 'bg-cyan-500/10 font-medium text-cyan-300'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {sortedRows.length === 0 ? (
            <EmptyState
              title="No allocation data"
              description="Seed or ingest an estate, then tag accounts and assets to see allocation."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{DIMENSIONS.find((d) => d.value === dimension)?.label ?? dimension}</TH>
                  <TH>Distribution</TH>
                  <TH className="text-right">Assets</TH>
                  <TH className="text-right">Spend / mo</TH>
                  <TH className="text-right">Recoverable / mo</TH>
                  <TH className="text-right">% recoverable</TH>
                </TR>
              </THead>
              <TBody>
                {sortedRows.map((r, i) => {
                  const spend = rowSpend(r)
                  const recoverable = rowRecoverable(r)
                  const pct = spend > 0 ? Math.round((recoverable / spend) * 100) : 0
                  const barPct = Math.round((spend / maxSpend) * 100)
                  return (
                    <TR key={r.key ?? r.value ?? i}>
                      <TD className="font-medium text-slate-200">{rowLabel(r)}</TD>
                      <TD>
                        <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300"
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums text-slate-400">{rowCount(r)}</TD>
                      <TD className="text-right tabular-nums text-slate-200">{fmtUSD2(spend)}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">
                        {fmtUSD2(recoverable)}
                      </TD>
                      <TD className="text-right">
                        <Badge tone={pct >= 30 ? 'green' : pct >= 10 ? 'amber' : 'slate'}>
                          {pct}%
                        </Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Tags inventory */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Tag dimensions</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Distinct tag keys and values currently in use across the estate.
          </p>
        </CardHeader>
        <CardBody>
          {tagsByKey.size === 0 ? (
            <EmptyState
              title="No tags found"
              description="Apply tags to assets (in Inventory) to enable richer allocation."
            />
          ) : (
            <div className="space-y-3">
              {Array.from(tagsByKey.entries()).map(([key, values]) => (
                <div key={key} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {key}
                  </span>
                  {values.length === 0 ? (
                    <Badge tone="slate">—</Badge>
                  ) : (
                    values.map((v) => (
                      <Badge key={v} tone="cyan">
                        {v}
                      </Badge>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Untagged gaps */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Untagged assets</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Assets without allocation tags create cost-attribution gaps.
            </p>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search untagged..."
            className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody>
          {(untagged.assets ?? []).length === 0 ? (
            <EmptyState
              title="No untagged assets"
              description="Every asset has allocation tags. Cost attribution is complete."
            />
          ) : filteredUntagged.length === 0 ? (
            <EmptyState title="No matches" description="Adjust your search to see untagged assets." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Asset</TH>
                  <TH>Type</TH>
                  <TH>Provider</TH>
                  <TH>Region</TH>
                  <TH>Tier</TH>
                  <TH className="text-right">Monthly cost</TH>
                </TR>
              </THead>
              <TBody>
                {filteredUntagged.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-medium text-slate-200">{a.name ?? a.id}</TD>
                    <TD>
                      <Badge tone="slate">{a.asset_type ?? '—'}</Badge>
                    </TD>
                    <TD className="text-slate-400">{a.provider ?? '—'}</TD>
                    <TD className="text-slate-400">{a.region ?? '—'}</TD>
                    <TD>
                      <Badge tone="blue">{a.current_tier ?? '—'}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-amber-300">
                      {fmtUSD2(a.monthly_cost)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
