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

interface Snapshot {
  id: string
  account_id?: string | null
  external_id?: string | null
  name?: string | null
  asset_type?: string | null
  provider?: string | null
  region?: string | null
  current_tier?: string | null
  size_bytes?: number | null
  monthly_cost?: number | null
  source_asset_id?: string | null
  is_incremental?: boolean | null
  asset_created_at?: string | null
  last_modified_at?: string | null
}

interface Chain {
  source_asset_id?: string | null
  source_name?: string | null
  snapshots?: Snapshot[]
  count?: number | null
  total_size_bytes?: number | null
  total_monthly_cost?: number | null
}

interface ChainsResponse {
  chains?: Chain[]
}

interface PruneCandidate {
  id?: string
  asset_id?: string | null
  account_id?: string | null
  name?: string | null
  reason?: string | null
  current_tier?: string | null
  size_bytes?: number | null
  monthly_cost?: number | null
  monthly_savings?: number | null
  annual_savings?: number | null
  age_days?: number | null
  target_tier?: string | null
  effort_score?: number | null
  risk_score?: number | null
  priority_score?: number | null
}

interface PruneResponse {
  candidates?: PruneCandidate[]
  total_monthly?: number | null
}

function money(n?: number | null) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function money2(n?: number | null) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}
function bytes(n?: number | null) {
  let v = Number(n || 0)
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
function reasonTone(reason?: string | null): 'rose' | 'amber' | 'slate' {
  const r = (reason || '').toLowerCase()
  if (r.includes('orphan') || r.includes('redundant')) return 'rose'
  if (r.includes('stale') || r.includes('old')) return 'amber'
  return 'slate'
}

type Tab = 'ledger' | 'chains' | 'prune'

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [chains, setChains] = useState<Chain[]>([])
  const [candidates, setCandidates] = useState<PruneCandidate[]>([])
  const [pruneTotal, setPruneTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('ledger')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [promoting, setPromoting] = useState<PruneCandidate | null>(null)
  const [owner, setOwner] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [promotedIds, setPromotedIds] = useState<Record<string, true>>({})
  const [selected, setSelected] = useState<Record<string, true>>({})
  const [banner, setBanner] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [snaps, ch, pr] = await Promise.all([
        api.getSnapshots(),
        api.getSnapshotChains(),
        api.getSnapshotPruneCandidates(),
      ])
      setSnapshots(Array.isArray(snaps) ? snaps : [])
      const chResp = ch as ChainsResponse
      setChains(Array.isArray(chResp?.chains) ? chResp.chains : [])
      const prResp = pr as PruneResponse
      setCandidates(Array.isArray(prResp?.candidates) ? prResp.candidates : [])
      setPruneTotal(Number(prResp?.total_monthly || 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshot data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const ledgerCost = useMemo(() => snapshots.reduce((a, s) => a + Number(s.monthly_cost || 0), 0), [snapshots])
  const ledgerSize = useMemo(() => snapshots.reduce((a, s) => a + Number(s.size_bytes || 0), 0), [snapshots])

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return snapshots
    return snapshots.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.external_id || '').toLowerCase().includes(q) ||
        (s.provider || '').toLowerCase().includes(q) ||
        (s.region || '').toLowerCase().includes(q),
    )
  }, [snapshots, search])

  const candidateKey = (c: PruneCandidate) => c.id || c.asset_id || ''

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected[candidateKey(c)] && !promotedIds[candidateKey(c)]),
    [candidates, selected, promotedIds],
  )
  const selectedSavings = useMemo(
    () => selectedCandidates.reduce((a, c) => a + Number(c.monthly_savings ?? c.monthly_cost ?? 0), 0),
    [selectedCandidates],
  )

  function toggleSelect(c: PruneCandidate) {
    const k = candidateKey(c)
    setSelected((s) => {
      const next = { ...s }
      if (next[k]) delete next[k]
      else next[k] = true
      return next
    })
  }

  function openPromote(c: PruneCandidate) {
    setPromoting(c)
    setOwner('')
    setNotes('')
    setFormError(null)
  }

  function actionPayload(c: PruneCandidate, o?: string, n?: string) {
    return {
      asset_id: c.asset_id ?? undefined,
      account_id: c.account_id ?? undefined,
      action_type: 'snapshot_prune',
      title: c.name ? `Prune ${c.name}` : 'Prune snapshot',
      target_tier: c.target_tier ?? undefined,
      monthly_savings: c.monthly_savings ?? c.monthly_cost ?? 0,
      annual_savings: c.annual_savings ?? Number(c.monthly_savings ?? c.monthly_cost ?? 0) * 12,
      effort_score: c.effort_score ?? 0,
      risk_score: c.risk_score ?? 0,
      priority_score: c.priority_score ?? 0,
      owner: o?.trim() || undefined,
      notes: (n?.trim() || c.reason) ?? undefined,
      status: 'proposed',
    }
  }

  async function submitPromote() {
    if (!promoting) return
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createAction(actionPayload(promoting, owner, notes))
      setPromotedIds((p) => ({ ...p, [candidateKey(promoting)]: true }))
      setBanner(`Queued prune action for "${promoting.name || 'snapshot'}".`)
      setPromoting(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to promote candidate')
    } finally {
      setSubmitting(false)
    }
  }

  async function promoteSelected() {
    if (selectedCandidates.length === 0) return
    setSubmitting(true)
    let ok = 0
    const failed: string[] = []
    for (const c of selectedCandidates) {
      try {
        await api.createAction(actionPayload(c))
        setPromotedIds((p) => ({ ...p, [candidateKey(c)]: true }))
        ok++
      } catch {
        failed.push(c.name || candidateKey(c))
      }
    }
    setSelected({})
    setSubmitting(false)
    setBanner(
      failed.length
        ? `Promoted ${ok} of ${selectedCandidates.length}. Failed: ${failed.join(', ')}.`
        : `Promoted ${ok} prune candidate${ok === 1 ? '' : 's'} to the worksheet.`,
    )
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ledger', label: 'Ledger', count: snapshots.length },
    { key: 'chains', label: 'Chains', count: chains.length },
    { key: 'prune', label: 'Prune candidates', count: candidates.length },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Snapshots &amp; Backups</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Carrying cost of snapshot and backup data, incremental chains by source, and prune candidates you can
            promote to the recovery worksheet.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Snapshot carrying cost" value={money(ledgerCost)} hint={`${snapshots.length} objects`} tone="amber" />
        <Stat label="Total snapshot data" value={bytes(ledgerSize)} hint="Stored size" />
        <Stat label="Chains" value={chains.length.toLocaleString()} hint="Lineage groups" />
        <Stat
          label="Prunable / mo"
          value={money(pruneTotal)}
          hint={`${candidates.length} candidates`}
          tone="cyan"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  tab === t.key ? 'bg-lime-500/15 font-medium text-lime-300' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label} <span className="text-xs text-zinc-600">({t.count})</span>
              </button>
            ))}
          </div>
          {tab === 'ledger' && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search snapshots..."
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
            />
          )}
          {tab === 'prune' && selectedCandidates.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-zinc-400">
                {selectedCandidates.length} selected ·{' '}
                <span className="font-medium text-lime-300">{money(selectedSavings)}</span>/mo
              </span>
              <Button onClick={promoteSelected} disabled={submitting} className="px-3 py-1.5 text-xs">
                {submitting ? 'Promoting...' : 'Promote selected'}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="py-16">
              <Spinner label="Loading snapshot ledger..." />
            </div>
          ) : error ? (
            <div className="px-5 py-10">
              <EmptyState
                title="Could not load snapshots"
                description={error}
                icon="⚠"
                action={
                  <Button variant="secondary" onClick={load}>
                    Try again
                  </Button>
                }
              />
            </div>
          ) : tab === 'ledger' ? (
            filteredLedger.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState
                  title={snapshots.length === 0 ? 'No snapshots or backups found' : 'No snapshots match your search'}
                  description={
                    snapshots.length === 0
                      ? 'Ingest or seed an estate to populate snapshot and backup inventory.'
                      : 'Try a different search term.'
                  }
                  icon="▤"
                />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Snapshot / Backup</TH>
                    <TH>Provider</TH>
                    <TH>Region</TH>
                    <TH>Tier</TH>
                    <TH className="text-center">Type</TH>
                    <TH className="text-right">Size</TH>
                    <TH className="text-right">Cost / mo</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredLedger.map((s) => (
                    <TR key={s.id}>
                      <TD>
                        <div className="font-medium text-zinc-100">{s.name || s.external_id || s.id}</div>
                        <div className="mt-0.5 text-xs text-zinc-600">{s.asset_type}</div>
                      </TD>
                      <TD className="text-zinc-400">{s.provider || '—'}</TD>
                      <TD className="text-zinc-400">{s.region || '—'}</TD>
                      <TD>{s.current_tier ? <Badge tone="slate">{s.current_tier}</Badge> : '—'}</TD>
                      <TD className="text-center">
                        {s.is_incremental ? <Badge tone="violet">incremental</Badge> : <Badge tone="blue">full</Badge>}
                      </TD>
                      <TD className="text-right tabular-nums text-zinc-400">{bytes(s.size_bytes)}</TD>
                      <TD className="text-right tabular-nums font-medium text-amber-300">{money2(s.monthly_cost)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )
          ) : tab === 'chains' ? (
            chains.length === 0 ? (
              <div className="px-5 py-10">
                <EmptyState title="No snapshot chains" description="No incremental lineage was detected in the current estate." icon="⛓" />
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {chains.map((c, idx) => {
                  const key = c.source_asset_id || `chain-${idx}`
                  const isOpen = !!expanded[key]
                  const list = c.snapshots || []
                  return (
                    <div key={key}>
                      <button
                        onClick={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))}
                        className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-zinc-800/40"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-zinc-500">{isOpen ? '▾' : '▸'}</span>
                          <div>
                            <div className="font-medium text-zinc-100">
                              {c.source_name || c.source_asset_id || 'Unsourced chain'}
                            </div>
                            <div className="text-xs text-zinc-600">
                              {Number(c.count ?? list.length)} snapshot{Number(c.count ?? list.length) === 1 ? '' : 's'} ·{' '}
                              {bytes(c.total_size_bytes ?? list.reduce((a, s) => a + Number(s.size_bytes || 0), 0))}
                            </div>
                          </div>
                        </div>
                        <Badge tone="amber">
                          {money2(c.total_monthly_cost ?? list.reduce((a, s) => a + Number(s.monthly_cost || 0), 0))}/mo
                        </Badge>
                      </button>
                      {isOpen && list.length > 0 && (
                        <div className="bg-zinc-950/50 px-5 pb-3">
                          <Table>
                            <THead>
                              <TR>
                                <TH>Snapshot</TH>
                                <TH className="text-center">Type</TH>
                                <TH className="text-right">Size</TH>
                                <TH className="text-right">Cost / mo</TH>
                                <TH>Created</TH>
                              </TR>
                            </THead>
                            <TBody>
                              {list.map((s) => (
                                <TR key={s.id}>
                                  <TD className="text-zinc-200">{s.name || s.external_id || s.id}</TD>
                                  <TD className="text-center">
                                    {s.is_incremental ? (
                                      <Badge tone="violet">incremental</Badge>
                                    ) : (
                                      <Badge tone="blue">full</Badge>
                                    )}
                                  </TD>
                                  <TD className="text-right tabular-nums text-zinc-400">{bytes(s.size_bytes)}</TD>
                                  <TD className="text-right tabular-nums text-amber-300">{money2(s.monthly_cost)}</TD>
                                  <TD className="text-xs text-zinc-500">
                                    {s.asset_created_at ? new Date(s.asset_created_at).toLocaleDateString() : '—'}
                                  </TD>
                                </TR>
                              ))}
                            </TBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          ) : candidates.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title="No prune candidates"
                description="No redundant, stale, or orphaned snapshots were detected. Run an analysis to refresh."
                icon="✓"
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10"></TH>
                  <TH>Candidate</TH>
                  <TH>Reason</TH>
                  <TH>Tier</TH>
                  <TH className="text-right">Age</TH>
                  <TH className="text-right">Size</TH>
                  <TH className="text-right">Savings / mo</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {candidates.map((c) => {
                  const k = candidateKey(c)
                  const done = !!promotedIds[k]
                  return (
                    <TR key={k}>
                      <TD>
                        <input
                          type="checkbox"
                          checked={!!selected[k]}
                          disabled={done}
                          onChange={() => toggleSelect(c)}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-lime-500"
                        />
                      </TD>
                      <TD>
                        <div className="font-medium text-zinc-100">{c.name || c.asset_id || k}</div>
                      </TD>
                      <TD>{c.reason ? <Badge tone={reasonTone(c.reason)}>{c.reason}</Badge> : '—'}</TD>
                      <TD>{c.current_tier ? <Badge tone="slate">{c.current_tier}</Badge> : '—'}</TD>
                      <TD className="text-right tabular-nums text-zinc-400">
                        {c.age_days != null ? `${Number(c.age_days).toFixed(0)}d` : '—'}
                      </TD>
                      <TD className="text-right tabular-nums text-zinc-400">{bytes(c.size_bytes)}</TD>
                      <TD className="text-right tabular-nums font-medium text-lime-300">
                        {money2(c.monthly_savings ?? c.monthly_cost)}
                      </TD>
                      <TD className="text-right">
                        {done ? (
                          <Badge tone="green">Promoted ✓</Badge>
                        ) : (
                          <Button onClick={() => openPromote(c)} className="px-3 py-1.5 text-xs">
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
        title="Promote prune candidate"
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
              <div className="font-medium text-zinc-100">{promoting.name || 'Snapshot'}</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {promoting.reason && <Badge tone={reasonTone(promoting.reason)}>{promoting.reason}</Badge>}
                {promoting.current_tier && <Badge tone="slate">{promoting.current_tier}</Badge>}
                <Badge tone="cyan">{money2(promoting.monthly_savings ?? promoting.monthly_cost)}/mo</Badge>
                {promoting.size_bytes != null && <Badge tone="blue">{bytes(promoting.size_bytes)}</Badge>}
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
                placeholder={promoting.reason || 'Context for the prune action (optional)'}
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
