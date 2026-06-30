'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Stat } from '@/components/ui/Stat'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Account {
  id: string
  name?: string
  provider?: string
  default_region?: string
}

interface IngestRun {
  id: string
  account_id?: string
  source?: string
  rows_parsed?: number
  assets_upserted?: number
  errors?: unknown
  status?: string
  created_at?: string
}

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

const statusTone = (s?: string): 'green' | 'amber' | 'rose' | 'slate' | 'cyan' => {
  switch ((s || '').toLowerCase()) {
    case 'completed':
    case 'success':
    case 'ok':
      return 'green'
    case 'partial':
    case 'pending':
    case 'running':
      return 'amber'
    case 'failed':
    case 'error':
      return 'rose'
    default:
      return 'slate'
  }
}

const errorCount = (errs: unknown): number => {
  if (!errs) return 0
  if (Array.isArray(errs)) return errs.length
  if (typeof errs === 'object') return Object.keys(errs as object).length
  return 0
}

const SAMPLE_ASSETS = `external_id,name,asset_type,provider,region,current_tier,size_bytes,object_count,monthly_cost
vol-0a1b2c,logs-archive,object,aws,us-east-1,standard,5497558138880,124000,126.50
vol-0d4e5f,db-backups,backup,aws,us-east-1,standard,2199023255552,42,50.20
snap-09xyz,nightly-snap,snapshot,aws,us-west-2,standard,1099511627776,1,25.10`

export default function IngestPage() {
  const [runs, setRuns] = useState<IngestRun[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [accountId, setAccountId] = useState('')
  const [source, setSource] = useState('csv')
  const [raw, setRaw] = useState('')
  const [uploading, setUploading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'green' | 'rose'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, a] = await Promise.all([api.getIngestRuns(), api.getAccounts()])
      const runsArr: IngestRun[] = Array.isArray(r) ? r : []
      const accArr: Account[] = Array.isArray(a) ? a : []
      setRuns(runsArr)
      setAccounts(accArr)
      setAccountId((cur) => cur || (accArr[0]?.id ?? ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ingestion data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const accountName = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a.name || a.id]))
    return (id?: string) => (id ? m.get(id) || id : '—')
  }, [accounts])

  // Parse pasted CSV/JSON into row objects for the upload payload.
  const parsedRows = useMemo(() => {
    const text = raw.trim()
    if (!text) return { rows: [] as Record<string, unknown>[], err: null as string | null }
    try {
      if (text.startsWith('[') || text.startsWith('{')) {
        const json = JSON.parse(text)
        const rows = Array.isArray(json) ? json : json.rows || json.assets || []
        return { rows: rows as Record<string, unknown>[], err: null }
      }
      // CSV
      const lines = text.split(/\r?\n/).filter((l) => l.trim())
      if (lines.length < 2) return { rows: [], err: 'CSV needs a header row and at least one data row.' }
      const headers = lines[0].split(',').map((h) => h.trim())
      const rows = lines.slice(1).map((line) => {
        const cells = line.split(',')
        const obj: Record<string, unknown> = {}
        headers.forEach((h, i) => {
          const v = (cells[i] ?? '').trim()
          // numeric coercion for known numeric fields
          if (/^(size_bytes|object_count|monthly_cost|reads_30d|reads_90d|requests_30d|retrieval_gb_30d|days_since_access)$/.test(h)) {
            obj[h] = v === '' ? null : Number(v)
          } else {
            obj[h] = v
          }
        })
        return obj
      })
      return { rows, err: null }
    } catch (e) {
      return { rows: [], err: e instanceof Error ? e.message : 'Could not parse input' }
    }
  }, [raw])

  const onFile = async (file: File) => {
    const text = await file.text()
    setRaw(text)
    if (/\.json$/i.test(file.name)) setSource('json')
    else setSource('csv')
  }

  const doUpload = async () => {
    setNotice(null)
    if (!accountId) {
      setNotice({ tone: 'rose', text: 'Select a target account first.' })
      return
    }
    if (parsedRows.err) {
      setNotice({ tone: 'rose', text: parsedRows.err })
      return
    }
    if (parsedRows.rows.length === 0) {
      setNotice({ tone: 'rose', text: 'No rows to upload. Paste CSV/JSON or load a file.' })
      return
    }
    setUploading(true)
    try {
      const res = await api.uploadIngest({ account_id: accountId, source, rows: parsedRows.rows })
      const upserted = res?.assets_upserted ?? res?.run?.assets_upserted ?? parsedRows.rows.length
      setNotice({ tone: 'green', text: `Ingested ${parsedRows.rows.length} rows · ${upserted} assets upserted.` })
      setRaw('')
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (e) {
      setNotice({ tone: 'rose', text: e instanceof Error ? e.message : 'Upload failed' })
    } finally {
      setUploading(false)
    }
  }

  const doSeed = async () => {
    setNotice(null)
    setSeeding(true)
    try {
      const res = await api.seedSample(accountId ? { account_id: accountId } : undefined)
      const nAcc = Array.isArray(res?.accounts) ? res.accounts.length : res?.accounts ?? 0
      const nAssets = Array.isArray(res?.assets) ? res.assets.length : res?.assets ?? 0
      setNotice({ tone: 'green', text: `Seeded sample estate · ${nAcc} accounts · ${nAssets} assets.` })
      await load()
    } catch (e) {
      setNotice({ tone: 'rose', text: e instanceof Error ? e.message : 'Seed failed' })
    } finally {
      setSeeding(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading ingestion ledger..." />
      </div>
    )
  }

  if (error && runs.length === 0 && accounts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="border-rose-500/30">
          <CardBody>
            <h2 className="text-base font-semibold text-rose-300">Could not load ingestion</h2>
            <p className="mt-1 text-sm text-slate-400">{error}</p>
            <Button className="mt-4" variant="secondary" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  const totalRows = runs.reduce((s, r) => s + Number(r.rows_parsed ?? 0), 0)
  const totalUpserts = runs.reduce((s, r) => s + Number(r.assets_upserted ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Ingest</h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload storage inventory exports (CSV / JSON) or seed a sample estate, then review the run ledger.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Ingestion Runs" value={runs.length.toLocaleString()} />
        <Stat label="Rows Parsed" value={totalRows.toLocaleString()} tone="cyan" />
        <Stat label="Assets Upserted" value={totalUpserts.toLocaleString()} tone="green" />
      </div>

      {accounts.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          You have no cloud accounts yet. Seed a sample estate below, or{' '}
          <Link href="/dashboard/accounts" className="font-medium text-amber-100 underline">
            create an account
          </Link>{' '}
          before uploading inventory.
        </div>
      )}

      {notice && (
        <div
          className={`rounded-lg border px-4 py-2 text-sm ${
            notice.tone === 'green'
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/5 text-rose-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Upload */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Upload inventory</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Target account</span>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className={inputCls}
                  disabled={accounts.length === 0}
                >
                  {accounts.length === 0 && <option value="">No accounts</option>}
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.id} {a.provider ? `(${a.provider})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Source format</span>
                <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
                className="block text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:text-slate-200 hover:file:bg-slate-700"
              />
              <Button variant="ghost" className="text-xs" onClick={() => { setRaw(SAMPLE_ASSETS); setSource('csv') }}>
                Load example CSV
              </Button>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Rows ({source.toUpperCase()})
              </span>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={8}
                placeholder={source === 'json' ? '[{ "external_id": "vol-0a1b2c", "asset_type": "object", ... }]' : 'external_id,name,asset_type,...'}
                className={`${inputCls} font-mono text-xs`}
              />
            </label>

            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                {parsedRows.err ? (
                  <span className="text-rose-300">{parsedRows.err}</span>
                ) : (
                  <span>
                    {parsedRows.rows.length} row{parsedRows.rows.length === 1 ? '' : 's'} parsed
                  </span>
                )}
              </div>
              <Button onClick={doUpload} disabled={uploading || accounts.length === 0}>
                {uploading ? 'Uploading...' : 'Upload & ingest'}
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Seed */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Seed sample estate</h2>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-slate-400">
              Generate a realistic sample estate — accounts, storage assets, access patterns, and a default pricing book —
              so you can explore detectors and the recovery worksheet immediately.
            </p>
            <ul className="space-y-1 text-xs text-slate-500">
              <li>• Multi-provider accounts</li>
              <li>• Object, snapshot, backup &amp; volume assets</li>
              <li>• 30/90-day access patterns</li>
              <li>• Default pricing entries</li>
            </ul>
            <Button variant="secondary" className="w-full" onClick={doSeed} disabled={seeding}>
              {seeding ? 'Seeding...' : 'Seed sample data'}
            </Button>
          </CardBody>
        </Card>
      </div>

      {/* Run ledger */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Ingestion run ledger</h2>
        </CardHeader>
        <CardBody className="p-0">
          {runs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No ingestion runs yet"
                description="Upload an inventory export or seed a sample estate to record your first run."
                icon={<span>⇪</span>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Account</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Rows Parsed</TH>
                  <TH className="text-right">Assets Upserted</TH>
                  <TH className="text-right">Errors</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {runs.map((r) => {
                  const errs = errorCount(r.errors)
                  return (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap text-xs text-slate-400">{fmtDate(r.created_at)}</TD>
                      <TD className="text-slate-200">{accountName(r.account_id)}</TD>
                      <TD>
                        <Badge tone="cyan">{(r.source || 'unknown').toUpperCase()}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{Number(r.rows_parsed ?? 0).toLocaleString()}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">
                        {Number(r.assets_upserted ?? 0).toLocaleString()}
                      </TD>
                      <TD className="text-right tabular-nums">
                        {errs > 0 ? <span className="text-rose-300">{errs}</span> : <span className="text-slate-600">0</span>}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(r.status)}>{r.status || 'unknown'}</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none'
