'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
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
  source_asset_id: string | null
  is_incremental: boolean | null
  attached: boolean | null
  detached_since: string | null
  asset_created_at: string | null
  last_modified_at: string | null
  tags: Record<string, string> | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface Access {
  reads_30d: number | null
  reads_90d: number | null
  requests_30d: number | null
  retrieval_gb_30d: number | null
  last_access_at: string | null
  days_since_access: number | null
  temperature: string
  access_score: number | null
}

interface Finding {
  id: string
  finding_type: string
  title: string
  detail: string | null
  recommended_action: string | null
  target_tier: string | null
  monthly_savings: number
  annual_savings: number
  effort_score: number | null
  risk_score: number | null
  priority_score: number | null
  confidence: number | null
}

interface AssetDetail {
  asset: Asset
  access: Access | null
  findings: Finding[]
}

const tierTone: Record<string, 'rose' | 'amber' | 'blue' | 'cyan' | 'slate'> = {
  hot: 'rose',
  warm: 'amber',
  cold: 'blue',
  archive: 'cyan',
  'deep-archive': 'slate',
}

const tempTone: Record<string, 'rose' | 'amber' | 'blue' | 'cyan' | 'slate'> = {
  hot: 'rose',
  warm: 'amber',
  cold: 'blue',
  frozen: 'cyan',
  never: 'slate',
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

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

interface TagRow {
  key: string
  value: string
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [data, setData] = useState<AssetDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tags, setTags] = useState<TagRow[]>([])
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [savingTags, setSavingTags] = useState(false)
  const [tagMsg, setTagMsg] = useState<string | null>(null)

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getAsset(id)
      setData(res)
      const t = res?.asset?.tags ?? {}
      setTags(Object.entries(t).map(([key, value]) => ({ key, value: String(value) })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load asset')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function addTag() {
    const k = newKey.trim()
    if (!k) return
    setTags((prev) => {
      const without = prev.filter((t) => t.key !== k)
      return [...without, { key: k, value: newValue.trim() }]
    })
    setNewKey('')
    setNewValue('')
  }

  function removeTag(key: string) {
    setTags((prev) => prev.filter((t) => t.key !== key))
  }

  async function saveTags() {
    if (!id) return
    setSavingTags(true)
    setTagMsg(null)
    try {
      const tagObj: Record<string, string> = {}
      for (const t of tags) if (t.key) tagObj[t.key] = t.value
      const updated = await api.updateAssetTags(id, { tags: tagObj })
      setData((prev) => (prev ? { ...prev, asset: { ...prev.asset, ...updated, tags: tagObj } } : prev))
      setTagMsg('Tags saved')
      setTimeout(() => setTagMsg(null), 2500)
    } catch (e) {
      setTagMsg(e instanceof Error ? e.message : 'Failed to save tags')
    } finally {
      setSavingTags(false)
    }
  }

  if (loading) {
    return (
      <div className="py-24">
        <Spinner label="Loading asset…" />
      </div>
    )
  }

  if (error || !data?.asset) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/inventory" className="text-sm text-lime-400 hover:text-lime-300">
          ← Back to inventory
        </Link>
        <EmptyState
          title={error ? 'Could not load asset' : 'Asset not found'}
          description={error || 'This asset may have been removed.'}
          action={
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          }
        />
      </div>
    )
  }

  const { asset, access, findings } = data
  const totalSavings = findings.reduce((s, f) => s + (f.monthly_savings || 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/inventory" className="text-sm text-lime-400 hover:text-lime-300">
          ← Back to inventory
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-zinc-100">{asset.name}</h1>
            <Badge tone={tierTone[asset.current_tier] ?? 'slate'}>{asset.current_tier}</Badge>
            <Badge tone="default" className="capitalize">
              {asset.asset_type}
            </Badge>
            {access && <Badge tone={tempTone[access.temperature] ?? 'slate'}>{access.temperature}</Badge>}
          </div>
          <p className="mt-1 break-all text-sm text-zinc-500">{asset.external_id || asset.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Monthly cost" value={fmtUsd(asset.monthly_cost)} tone="amber" />
        <Stat label="Size" value={fmtBytes(asset.size_bytes)} hint={`${(asset.object_count ?? 0).toLocaleString()} objects`} />
        <Stat label="Recoverable / mo" value={fmtUsd(totalSavings)} tone={totalSavings > 0 ? 'green' : 'default'} />
        <Stat label="Open findings" value={findings.length} tone={findings.length > 0 ? 'cyan' : 'default'} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Properties */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Properties</h2>
          </CardHeader>
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label="Provider" value={<span className="uppercase">{asset.provider}</span>} />
              <Row label="Region" value={asset.region || '—'} />
              <Row label="Tier" value={asset.current_tier} />
              <Row label="Type" value={<span className="capitalize">{asset.asset_type}</span>} />
              <Row label="Attached" value={asset.attached === false ? 'Detached' : asset.attached ? 'Yes' : '—'} />
              {asset.detached_since && <Row label="Detached since" value={fmtDate(asset.detached_since)} />}
              {asset.source_asset_id && <Row label="Source asset" value={<span className="break-all">{asset.source_asset_id}</span>} />}
              {asset.is_incremental != null && asset.asset_type !== 'bucket' && asset.asset_type !== 'volume' && (
                <Row label="Incremental" value={asset.is_incremental ? 'Yes' : 'No'} />
              )}
              <Row label="Created" value={fmtDate(asset.asset_created_at)} />
              <Row label="Last modified" value={fmtDate(asset.last_modified_at)} />
            </dl>
          </CardBody>
        </Card>

        {/* Access */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Access pattern</h2>
          </CardHeader>
          <CardBody>
            {access ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Mini label="Temperature" value={access.temperature} accent={tempTone[access.temperature] ?? 'slate'} />
                <Mini label="Access score" value={(access.access_score ?? 0).toFixed(2)} />
                <Mini
                  label="Days since access"
                  value={access.days_since_access != null ? String(access.days_since_access) : '—'}
                />
                <Mini label="Reads 30d" value={(access.reads_30d ?? 0).toLocaleString()} />
                <Mini label="Reads 90d" value={(access.reads_90d ?? 0).toLocaleString()} />
                <Mini label="Requests 30d" value={(access.requests_30d ?? 0).toLocaleString()} />
                <Mini label="Retrieval 30d" value={`${(access.retrieval_gb_30d ?? 0).toFixed(1)} GB`} />
                <Mini label="Last access" value={fmtDate(access.last_access_at)} />
              </div>
            ) : (
              <EmptyState
                title="No access data"
                description="This asset has no enriched access pattern yet. Run enrichment from the Access Patterns page."
                action={
                  <Link href="/dashboard/access">
                    <Button variant="secondary">Access Patterns</Button>
                  </Link>
                }
              />
            )}
          </CardBody>
        </Card>
      </div>

      {/* Candidate actions / findings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Candidate actions</h2>
            <span className="text-xs text-zinc-500">{findings.length} finding(s)</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {findings.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No findings for this asset"
                description="Detectors have not flagged this asset. Run an analysis to refresh findings."
                action={
                  <Link href="/dashboard/analysis">
                    <Button variant="secondary">Analysis Runs</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Finding</TH>
                  <TH>Recommended action</TH>
                  <TH>Target tier</TH>
                  <TH className="text-right">Monthly</TH>
                  <TH className="text-right">Annual</TH>
                  <TH className="text-right">Effort / Risk</TH>
                  <TH className="text-right">Priority</TH>
                </TR>
              </THead>
              <TBody>
                {findings.map((f) => (
                  <TR key={f.id}>
                    <TD>
                      <div className="font-medium text-zinc-200">{f.title}</div>
                      {f.detail && <div className="text-xs text-zinc-500">{f.detail}</div>}
                      <Badge tone="violet" className="mt-1">
                        {f.finding_type}
                      </Badge>
                    </TD>
                    <TD className="capitalize">{f.recommended_action?.replace(/-/g, ' ') || '—'}</TD>
                    <TD>{f.target_tier ? <Badge tone={tierTone[f.target_tier] ?? 'slate'}>{f.target_tier}</Badge> : '—'}</TD>
                    <TD className="text-right tabular-nums text-emerald-300">{fmtUsd(f.monthly_savings)}</TD>
                    <TD className="text-right tabular-nums text-zinc-400">{fmtUsd(f.annual_savings)}</TD>
                    <TD className="text-right tabular-nums">
                      {f.effort_score ?? '—'} / {f.risk_score ?? '—'}
                    </TD>
                    <TD className="text-right tabular-nums text-lime-300">{(f.priority_score ?? 0).toFixed(1)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Tags editor */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Tags</h2>
            {tagMsg && (
              <span className={`text-xs ${tagMsg.includes('saved') ? 'text-emerald-400' : 'text-rose-400'}`}>{tagMsg}</span>
            )}
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {tags.length === 0 ? (
            <p className="text-sm text-zinc-500">No tags yet. Add cost-allocation tags below.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span
                  key={t.key}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-sm text-zinc-200"
                >
                  <span className="text-zinc-400">{t.key}</span>
                  <span className="text-zinc-600">=</span>
                  <span>{t.value || <em className="text-zinc-600">empty</em>}</span>
                  <button onClick={() => removeTag(t.key)} className="text-zinc-500 hover:text-rose-400" aria-label={`Remove ${t.key}`}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Key</label>
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder="environment"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Value</label>
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTag()}
                placeholder="production"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-lime-500 focus:outline-none"
              />
            </div>
            <Button variant="secondary" onClick={addTag} disabled={!newKey.trim()}>
              Add tag
            </Button>
            <Button onClick={saveTags} disabled={savingTags}>
              {savingTags ? 'Saving…' : 'Save tags'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-200">{value}</dd>
    </div>
  )
}

function Mini({
  label,
  value,
  accent,
}: {
  label: string
  value: React.ReactNode
  accent?: 'rose' | 'amber' | 'blue' | 'cyan' | 'slate'
}) {
  const accentText: Record<string, string> = {
    rose: 'text-rose-300',
    amber: 'text-amber-300',
    blue: 'text-lime-300',
    cyan: 'text-lime-300',
    slate: 'text-zinc-300',
  }
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold capitalize tabular-nums ${accent ? accentText[accent] : 'text-zinc-100'}`}>{value}</div>
    </div>
  )
}
