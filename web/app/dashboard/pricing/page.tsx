'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface PricingBook {
  id: string
  name?: string
  version?: string
  is_default?: boolean
  currency?: string
  created_at?: string
}

interface PricingEntry {
  id: string
  book_id?: string
  provider?: string
  region?: string
  tier?: string
  storage_per_gb_month?: number
  retrieval_per_gb?: number
  request_per_1k?: number
  min_duration_days?: number
  early_delete_penalty_per_gb?: number
  created_at?: string
}

const num = (v: unknown): number | undefined => {
  if (v === '' || v == null) return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

const fmtRate = (n?: number) =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 5 })}`

const INPUT_CLASS =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none'

const emptyEntryForm = {
  provider: '',
  region: '',
  tier: '',
  storage_per_gb_month: '',
  retrieval_per_gb: '',
  request_per_1k: '',
  min_duration_days: '',
  early_delete_penalty_per_gb: '',
}
type EntryForm = typeof emptyEntryForm

export default function PricingPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [books, setBooks] = useState<PricingBook[]>([])
  const [activeBookId, setActiveBookId] = useState<string | null>(null)
  const [entries, setEntries] = useState<PricingEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [providerFilter, setProviderFilter] = useState('')

  // book creation
  const [bookModalOpen, setBookModalOpen] = useState(false)
  const [bookForm, setBookForm] = useState({ name: '', version: '', currency: 'USD', is_default: false })
  const [savingBook, setSavingBook] = useState(false)

  // entry create/edit
  const [entryModalOpen, setEntryModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<PricingEntry | null>(null)
  const [entryForm, setEntryForm] = useState<EntryForm>(emptyEntryForm)
  const [savingEntry, setSavingEntry] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [busyId, setBusyId] = useState<string | null>(null)

  const loadBooks = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getPricingBooks()
      const list: PricingBook[] = (Array.isArray(res) ? res : res?.books ?? []) as PricingBook[]
      setBooks(list)
      const initial = list.find((b) => b.is_default)?.id ?? list[0]?.id ?? null
      setActiveBookId(initial)
      if (initial) await loadEntries(initial)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pricing books')
    } finally {
      setLoading(false)
    }
  }

  const loadEntries = async (bookId: string) => {
    setEntriesLoading(true)
    try {
      const res = await api.getPricingEntries(bookId)
      const list: PricingEntry[] = (Array.isArray(res) ? res : res?.entries ?? []) as PricingEntry[]
      setEntries(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entries')
      setEntries([])
    } finally {
      setEntriesLoading(false)
    }
  }

  useEffect(() => {
    loadBooks()
  }, [])

  const selectBook = async (id: string) => {
    setActiveBookId(id)
    setSearch('')
    setProviderFilter('')
    await loadEntries(id)
  }

  const activeBook = useMemo(
    () => books.find((b) => b.id === activeBookId) ?? null,
    [books, activeBookId],
  )

  const providers = useMemo(
    () => Array.from(new Set(entries.map((e) => e.provider).filter(Boolean))) as string[],
    [entries],
  )

  const filteredEntries = useMemo(() => {
    let rows = [...entries]
    if (providerFilter) rows = rows.filter((e) => e.provider === providerFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (e) =>
          (e.provider ?? '').toLowerCase().includes(q) ||
          (e.region ?? '').toLowerCase().includes(q) ||
          (e.tier ?? '').toLowerCase().includes(q),
      )
    }
    rows.sort(
      (a, b) =>
        (a.provider ?? '').localeCompare(b.provider ?? '') ||
        (a.region ?? '').localeCompare(b.region ?? '') ||
        (a.tier ?? '').localeCompare(b.tier ?? ''),
    )
    return rows
  }, [entries, providerFilter, search])

  // --- book create ---
  const submitBook = async () => {
    if (!bookForm.name.trim()) {
      return
    }
    setSavingBook(true)
    setError(null)
    try {
      const created: PricingBook = await api.createPricingBook({
        name: bookForm.name.trim(),
        version: bookForm.version.trim() || undefined,
        currency: bookForm.currency.trim() || 'USD',
        is_default: bookForm.is_default,
      })
      setBookModalOpen(false)
      setBookForm({ name: '', version: '', currency: 'USD', is_default: false })
      await loadBooks()
      if (created?.id) {
        setActiveBookId(created.id)
        await loadEntries(created.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create book')
    } finally {
      setSavingBook(false)
    }
  }

  // --- entry create/edit ---
  const openCreateEntry = () => {
    setEditingEntry(null)
    setEntryForm(emptyEntryForm)
    setFormError(null)
    setEntryModalOpen(true)
  }

  const openEditEntry = (e: PricingEntry) => {
    setEditingEntry(e)
    setEntryForm({
      provider: e.provider ?? '',
      region: e.region ?? '',
      tier: e.tier ?? '',
      storage_per_gb_month: e.storage_per_gb_month?.toString() ?? '',
      retrieval_per_gb: e.retrieval_per_gb?.toString() ?? '',
      request_per_1k: e.request_per_1k?.toString() ?? '',
      min_duration_days: e.min_duration_days?.toString() ?? '',
      early_delete_penalty_per_gb: e.early_delete_penalty_per_gb?.toString() ?? '',
    })
    setFormError(null)
    setEntryModalOpen(true)
  }

  const submitEntry = async () => {
    if (!activeBookId) return
    if (!entryForm.provider.trim() || !entryForm.region.trim() || !entryForm.tier.trim()) {
      setFormError('Provider, region and tier are required.')
      return
    }
    setSavingEntry(true)
    setFormError(null)
    const payload = {
      provider: entryForm.provider.trim(),
      region: entryForm.region.trim(),
      tier: entryForm.tier.trim(),
      storage_per_gb_month: num(entryForm.storage_per_gb_month),
      retrieval_per_gb: num(entryForm.retrieval_per_gb),
      request_per_1k: num(entryForm.request_per_1k),
      min_duration_days: num(entryForm.min_duration_days),
      early_delete_penalty_per_gb: num(entryForm.early_delete_penalty_per_gb),
    }
    try {
      if (editingEntry) {
        await api.updatePricingEntry(editingEntry.id, payload)
      } else {
        await api.createPricingEntry({ book_id: activeBookId, ...payload })
      }
      setEntryModalOpen(false)
      await loadEntries(activeBookId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save entry')
    } finally {
      setSavingEntry(false)
    }
  }

  const deleteEntry = async (id: string) => {
    if (!activeBookId) return
    if (!confirm('Delete this pricing entry?')) return
    setBusyId(id)
    try {
      await api.deletePricingEntry(id)
      await loadEntries(activeBookId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete entry')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Loading pricing books..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Pricing Book</h1>
          <p className="mt-1 text-sm text-slate-500">
            Define provider/region/tier rate cards that drive savings calculations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={loadBooks}>
            Refresh
          </Button>
          <Button onClick={() => setBookModalOpen(true)}>New book</Button>
        </div>
      </div>

      {error && (
        <Card className="border-rose-500/30">
          <CardBody className="flex items-center justify-between">
            <span className="text-sm text-rose-300">{error}</span>
            <Button variant="secondary" onClick={loadBooks}>
              Retry
            </Button>
          </CardBody>
        </Card>
      )}

      {books.length === 0 ? (
        <EmptyState
          title="No pricing books"
          description="Create a pricing book to start defining tier rate cards."
          action={<Button onClick={() => setBookModalOpen(true)}>Create pricing book</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-4">
          {/* Books list */}
          <div className="space-y-2 lg:col-span-1">
            <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Books
            </div>
            {books.map((b) => {
              const active = b.id === activeBookId
              return (
                <button
                  key={b.id}
                  onClick={() => selectBook(b.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? 'border-cyan-500/40 bg-cyan-500/5'
                      : 'border-slate-800 bg-slate-900 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-200">{b.name ?? b.id}</span>
                    {b.is_default && <Badge tone="cyan">default</Badge>}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    {b.version && <span>v{b.version}</span>}
                    <span>{b.currency ?? 'USD'}</span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Entries editor */}
          <div className="lg:col-span-3">
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-200">
                    {activeBook?.name ?? 'Entries'}
                    {activeBook?.version && (
                      <span className="ml-2 text-xs font-normal text-slate-500">v{activeBook.version}</span>
                    )}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">{entries.length} rate entries</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="">All providers</option>
                    {providers.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                  <Button onClick={openCreateEntry} disabled={!activeBookId}>
                    Add entry
                  </Button>
                </div>
              </CardHeader>
              <CardBody>
                {entriesLoading ? (
                  <div className="py-10">
                    <Spinner label="Loading entries..." />
                  </div>
                ) : entries.length === 0 ? (
                  <EmptyState
                    title="No entries in this book"
                    description="Add provider/region/tier rate entries to power savings math."
                    action={<Button onClick={openCreateEntry}>Add first entry</Button>}
                  />
                ) : filteredEntries.length === 0 ? (
                  <EmptyState title="No matches" description="Adjust filters or search." />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Provider</TH>
                        <TH>Region</TH>
                        <TH>Tier</TH>
                        <TH className="text-right">Storage /GB·mo</TH>
                        <TH className="text-right">Retrieval /GB</TH>
                        <TH className="text-right">Req /1k</TH>
                        <TH className="text-right">Min days</TH>
                        <TH className="text-right">Early-del /GB</TH>
                        <TH className="text-right">Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {filteredEntries.map((e) => (
                        <TR key={e.id}>
                          <TD className="font-medium text-slate-200">{e.provider ?? '—'}</TD>
                          <TD className="text-slate-400">{e.region ?? '—'}</TD>
                          <TD>
                            <Badge tone="blue">{e.tier ?? '—'}</Badge>
                          </TD>
                          <TD className="text-right tabular-nums text-cyan-300">
                            {fmtRate(e.storage_per_gb_month)}
                          </TD>
                          <TD className="text-right tabular-nums text-slate-300">
                            {fmtRate(e.retrieval_per_gb)}
                          </TD>
                          <TD className="text-right tabular-nums text-slate-300">
                            {fmtRate(e.request_per_1k)}
                          </TD>
                          <TD className="text-right tabular-nums text-slate-400">
                            {e.min_duration_days ?? '—'}
                          </TD>
                          <TD className="text-right tabular-nums text-slate-300">
                            {fmtRate(e.early_delete_penalty_per_gb)}
                          </TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" onClick={() => openEditEntry(e)}>
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                className="text-rose-400 hover:text-rose-300"
                                onClick={() => deleteEntry(e.id)}
                                disabled={busyId === e.id}
                              >
                                {busyId === e.id ? '...' : 'Delete'}
                              </Button>
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* Create book modal */}
      <Modal
        open={bookModalOpen}
        onClose={() => setBookModalOpen(false)}
        title="New pricing book"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBookModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitBook} disabled={savingBook || !bookForm.name.trim()}>
              {savingBook ? 'Creating...' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <input
              value={bookForm.name}
              onChange={(e) => setBookForm({ ...bookForm, name: e.target.value })}
              placeholder="e.g. AWS Standard 2026 Q2"
              className={INPUT_CLASS}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Version">
              <input
                value={bookForm.version}
                onChange={(e) => setBookForm({ ...bookForm, version: e.target.value })}
                placeholder="2026.06"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Currency">
              <input
                value={bookForm.currency}
                onChange={(e) => setBookForm({ ...bookForm, currency: e.target.value })}
                placeholder="USD"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={bookForm.is_default}
              onChange={(e) => setBookForm({ ...bookForm, is_default: e.target.checked })}
              className="h-4 w-4 accent-cyan-500"
            />
            Set as default book
          </label>
        </div>
      </Modal>

      {/* Entry modal */}
      <Modal
        open={entryModalOpen}
        onClose={() => setEntryModalOpen(false)}
        title={editingEntry ? 'Edit pricing entry' : 'Add pricing entry'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEntryModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitEntry} disabled={savingEntry}>
              {savingEntry ? 'Saving...' : editingEntry ? 'Save changes' : 'Create entry'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <p className="text-sm text-rose-300">{formError}</p>}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Provider">
              <input
                value={entryForm.provider}
                onChange={(e) => setEntryForm({ ...entryForm, provider: e.target.value })}
                placeholder="aws"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Region">
              <input
                value={entryForm.region}
                onChange={(e) => setEntryForm({ ...entryForm, region: e.target.value })}
                placeholder="us-east-1"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Tier">
              <input
                value={entryForm.tier}
                onChange={(e) => setEntryForm({ ...entryForm, tier: e.target.value })}
                placeholder="standard"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Storage $/GB·month">
              <input
                type="number"
                step="any"
                value={entryForm.storage_per_gb_month}
                onChange={(e) => setEntryForm({ ...entryForm, storage_per_gb_month: e.target.value })}
                placeholder="0.023"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Retrieval $/GB">
              <input
                type="number"
                step="any"
                value={entryForm.retrieval_per_gb}
                onChange={(e) => setEntryForm({ ...entryForm, retrieval_per_gb: e.target.value })}
                placeholder="0.01"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Request $/1k">
              <input
                type="number"
                step="any"
                value={entryForm.request_per_1k}
                onChange={(e) => setEntryForm({ ...entryForm, request_per_1k: e.target.value })}
                placeholder="0.0004"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Min duration (days)">
              <input
                type="number"
                step="any"
                value={entryForm.min_duration_days}
                onChange={(e) => setEntryForm({ ...entryForm, min_duration_days: e.target.value })}
                placeholder="0"
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Early-delete penalty $/GB">
              <input
                type="number"
                step="any"
                value={entryForm.early_delete_penalty_per_gb}
                onChange={(e) =>
                  setEntryForm({ ...entryForm, early_delete_penalty_per_gb: e.target.value })
                }
                placeholder="0"
                className={INPUT_CLASS}
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}
