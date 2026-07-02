'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Finding {
  id: string
  account_id?: string | null
  asset_id?: string | null
  finding_type?: string | null
  title?: string | null
  detail?: string | null
  recommended_action?: string | null
  target_tier?: string | null
  monthly_savings?: number | null
  annual_savings?: number | null
  effort_score?: number | null
  risk_score?: number | null
  priority_score?: number | null
  confidence?: number | null
  created_at?: string | null
}

interface MistierSummary {
  total_monthly?: number | null
  total_annual?: number | null
  count?: number | null
}

function money(n?: number | null) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function money2(n?: number | null) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function riskTone(score?: number | null): 'green' | 'amber' | 'rose' {
  const v = Number(score || 0)
  if (v >= 70) return 'rose'
  if (v >= 40) return 'amber'
  return 'green'
}

function confidenceTone(score?: number | null): 'green' | 'amber' | 'slate' {
  const v = Number(score || 0)
  if (v >= 0.75) return 'green'
  if (v >= 0.4) return 'amber'
  return 'slate'
}

export default function MistierPage() {
  const [findings, setFindings] = useState<Finding[]>([])
  const [summary, setSummary] = useState<MistierSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'priority' | 'savings' | 'risk'>('priority')

  const [promoting, setPromoting] = useState<Finding | null>(null)
  const [owner, setOwner] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [promotedIds, setPromotedIds] = useState<Record<string, true>>({})
  const [banner, setBanner] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [f, s] = await Promise.all([api.getMistier(), api.getMistierSummary()])
      setFindings(Array.isArray(f) ? f : [])
      setSummary(s || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mis-tier findings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const tiers = useMemo(() => {
    const set = new Set<string>()
    for (const f of findings) if (f.target_tier) set.add(f.target_tier)
    return Array.from(set).sort()
  }, [findings])

  const filtered = useMemo(() => {
    let rows = findings.slice()
    if (tierFilter !== 'all') rows = rows.filter((f) => f.target_tier === tierFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (f) =>
          (f.title || '').toLowerCase().includes(q) ||
          (f.detail || '').toLowerCase().includes(q) ||
          (f.recommended_action || '').toLowerCase().includes(q),
      )
    }
    rows.sort((a, b) => {
      if (sortBy === 'savings') return Number(b.monthly_savings || 0) - Number(a.monthly_savings || 0)
      if (sortBy === 'risk') return Number(a.risk_score || 0) - Number(b.risk_score || 0)
      return Number(b.priority_score || 0) - Number(a.priority_score || 0)
    })
    return rows
  }, [findings, tierFilter, search, sortBy])

  const filteredMonthly = useMemo(
    () => filtered.reduce((acc, f) => acc + Number(f.monthly_savings || 0), 0),
    [filtered],
  )

  function openPromote(f: Finding) {
    setPromoting(f)
    setOwner('')
    setNotes('')
    setFormError(null)
  }

  async function submitPromote() {
    if (!promoting) return
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createAction({
        finding_id: promoting.id,
        account_id: promoting.account_id ?? undefined,
        asset_id: promoting.asset_id ?? undefined,
        action_type: 'tier_change',
        title: promoting.title || 'Re-tier asset',
        target_tier: promoting.target_tier ?? undefined,
        monthly_savings: promoting.monthly_savings ?? 0,
        annual_savings: promoting.annual_savings ?? 0,
        effort_score: promoting.effort_score ?? 0,
        risk_score: promoting.risk_score ?? 0,
        priority_score: promoting.priority_score ?? 0,
        owner: owner.trim() || undefined,
        notes: notes.trim() || undefined,
        status: 'proposed',
      })
      setPromotedIds((p) => ({ ...p, [promoting.id]: true }))
      setBanner(`Promoted "${promoting.title || 'finding'}" to the recovery worksheet.`)
      setPromoting(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to promote finding')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Mis-Tier Findings</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Assets sitting on a more expensive storage class than their access pattern warrants. Promote a finding to
            queue a re-tier action on the recovery worksheet.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {banner && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="text-emerald-400 hover:text-emerald-200" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Recoverable / mo"
          value={money(summary?.total_monthly)}
          hint="Across all mis-tier findings"
          tone="cyan"
        />
        <Stat label="Recoverable / yr" value={money(summary?.total_annual)} hint="Annualized" tone="green" />
        <Stat label="Findings" value={Number(summary?.count || findings.length).toLocaleString()} hint="Open mis-tier opportunities" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, detail, action..."
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
            />
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            >
              <option value="all">All target tiers</option>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  → {t}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'priority' | 'savings' | 'risk')}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-lime-500 focus:outline-none"
            >
              <option value="priority">Sort: Priority</option>
              <option value="savings">Sort: Savings</option>
              <option value="risk">Sort: Lowest risk</option>
            </select>
          </div>
          <div className="text-sm text-zinc-500">
            <span className="font-medium text-zinc-300">{filtered.length}</span> shown ·{' '}
            <span className="font-medium text-lime-300">{money(filteredMonthly)}</span>/mo
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading mis-tier findings..." />
            </div>
          ) : error ? (
            <div className="px-5 py-10">
              <EmptyState
                title="Could not load findings"
                description={error}
                icon="⚠"
                action={
                  <Button variant="secondary" onClick={load}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title={findings.length === 0 ? 'No mis-tier findings yet' : 'No findings match your filters'}
                description={
                  findings.length === 0
                    ? 'Run an analysis from the Analysis Runs page to detect mis-tiered assets.'
                    : 'Try clearing the search or tier filter.'
                }
                icon="▤"
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Finding</TH>
                  <TH>Re-tier</TH>
                  <TH className="text-right">Savings / mo</TH>
                  <TH className="text-right">Annual</TH>
                  <TH className="text-center">Risk</TH>
                  <TH className="text-center">Effort</TH>
                  <TH className="text-center">Priority</TH>
                  <TH className="text-center">Conf.</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((f) => {
                  const done = !!promotedIds[f.id]
                  return (
                    <TR key={f.id}>
                      <TD>
                        <div className="font-medium text-zinc-100">{f.title || 'Mis-tier finding'}</div>
                        {f.detail && <div className="mt-0.5 max-w-md text-xs text-zinc-500">{f.detail}</div>}
                        {f.recommended_action && (
                          <div className="mt-1 text-xs text-lime-400/80">{f.recommended_action}</div>
                        )}
                      </TD>
                      <TD>{f.target_tier ? <Badge tone="blue">{f.target_tier}</Badge> : <span className="text-zinc-600">—</span>}</TD>
                      <TD className="text-right font-medium tabular-nums text-lime-300">{money2(f.monthly_savings)}</TD>
                      <TD className="text-right tabular-nums text-zinc-400">{money(f.annual_savings)}</TD>
                      <TD className="text-center">
                        <Badge tone={riskTone(f.risk_score)}>{Number(f.risk_score || 0).toFixed(0)}</Badge>
                      </TD>
                      <TD className="text-center tabular-nums text-zinc-400">{Number(f.effort_score || 0).toFixed(0)}</TD>
                      <TD className="text-center tabular-nums font-medium text-zinc-200">
                        {Number(f.priority_score || 0).toFixed(0)}
                      </TD>
                      <TD className="text-center">
                        <Badge tone={confidenceTone(f.confidence)}>
                          {Math.round(Number(f.confidence || 0) * 100)}%
                        </Badge>
                      </TD>
                      <TD className="text-right">
                        {done ? (
                          <Badge tone="green">Promoted ✓</Badge>
                        ) : (
                          <Button onClick={() => openPromote(f)} className="px-3 py-1.5 text-xs">
                            Promote
                          </Button>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!promoting}
        onClose={() => (submitting ? null : setPromoting(null))}
        title="Promote to recovery worksheet"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPromoting(null)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitPromote} disabled={submitting}>
              {submitting ? 'Promoting...' : 'Create action'}
            </Button>
          </>
        }
      >
        {promoting && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
              <div className="font-medium text-zinc-100">{promoting.title || 'Mis-tier finding'}</div>
              {promoting.detail && <div className="mt-1 text-xs text-zinc-500">{promoting.detail}</div>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {promoting.target_tier && <Badge tone="blue">→ {promoting.target_tier}</Badge>}
                <Badge tone="cyan">{money2(promoting.monthly_savings)}/mo</Badge>
                <Badge tone="green">{money(promoting.annual_savings)}/yr</Badge>
                <Badge tone={riskTone(promoting.risk_score)}>risk {Number(promoting.risk_score || 0).toFixed(0)}</Badge>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Owner</label>
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Assign an owner (optional)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Context for the recovery action (optional)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            {formError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {formError}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
