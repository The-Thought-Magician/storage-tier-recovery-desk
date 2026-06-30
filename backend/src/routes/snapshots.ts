import { Hono } from 'hono'
import { db } from '../db/index.js'
import { storage_assets, access_patterns } from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// Snapshot / backup bloat ledger.
//
// Operates over storage_assets whose asset_type is 'snapshot' or 'backup'.
// Groups assets into chains by source_asset_id (lineage), and surfaces prune
// candidates (redundant / stale / orphaned) with the monthly carrying cost
// that would be recovered by pruning them.
// ---------------------------------------------------------------------------

const SNAPSHOT_TYPES = ['snapshot', 'backup'] as const
const STALE_DAYS = 90 // no source activity / not modified within this window => stale

type Asset = typeof storage_assets.$inferSelect

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function daysSince(d: Date | string | null | undefined): number | null {
  if (!d) return null
  const t = new Date(d).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

async function loadSnapshots(c: any): Promise<Asset[]> {
  const accountId = c.req.query('account_id') as string | undefined
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const conds = [inArray(storage_assets.asset_type, [...SNAPSHOT_TYPES])]
  if (accountId) conds.push(eq(storage_assets.account_id, accountId))
  if (userId) conds.push(eq(storage_assets.user_id, userId))
  return db.select().from(storage_assets).where(and(...conds))
}

// ---------------------------------------------------------------------------
// GET / — public — snapshot/backup ledger with carrying cost
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const assets = await loadSnapshots(c)
  const ledger = assets
    .map((a) => ({
      ...a,
      size_gb: num(a.size_bytes) / 1_073_741_824,
      carrying_cost_monthly: num(a.monthly_cost),
      age_days: daysSince(a.asset_created_at),
      idle_days: daysSince(a.last_modified_at),
    }))
    .sort((x, y) => y.carrying_cost_monthly - x.carrying_cost_monthly)
  return c.json(ledger)
})

// ---------------------------------------------------------------------------
// GET /chains — public — chains / lineage grouped by source
// ---------------------------------------------------------------------------
router.get('/chains', async (c) => {
  const assets = await loadSnapshots(c)

  const groups = new Map<string, Asset[]>()
  for (const a of assets) {
    const key = a.source_asset_id ?? `__orphan__:${a.id}`
    const list = groups.get(key)
    if (list) list.push(a)
    else groups.set(key, [a])
  }

  const chains = [...groups.entries()].map(([key, members]) => {
    const isOrphan = key.startsWith('__orphan__:')
    const sorted = [...members].sort((x, y) => {
      const tx = x.asset_created_at ? new Date(x.asset_created_at).getTime() : 0
      const ty = y.asset_created_at ? new Date(y.asset_created_at).getTime() : 0
      return tx - ty
    })
    const total_size_bytes = sorted.reduce((s, a) => s + num(a.size_bytes), 0)
    const total_monthly_cost = sorted.reduce((s, a) => s + num(a.monthly_cost), 0)
    const incremental_count = sorted.filter((a) => a.is_incremental).length
    return {
      source_asset_id: isOrphan ? null : key,
      orphaned_chain: isOrphan,
      depth: sorted.length,
      incremental_count,
      full_count: sorted.length - incremental_count,
      total_size_bytes,
      total_size_gb: total_size_bytes / 1_073_741_824,
      total_monthly_cost,
      oldest_at: sorted[0]?.asset_created_at ?? null,
      newest_at: sorted[sorted.length - 1]?.asset_created_at ?? null,
      snapshots: sorted.map((a) => ({
        id: a.id,
        name: a.name,
        asset_type: a.asset_type,
        is_incremental: a.is_incremental,
        size_bytes: a.size_bytes,
        monthly_cost: a.monthly_cost,
        asset_created_at: a.asset_created_at,
      })),
    }
  })

  chains.sort((a, b) => b.total_monthly_cost - a.total_monthly_cost)
  return c.json({ chains })
})

// ---------------------------------------------------------------------------
// GET /prune-candidates — public — redundant/stale/orphaned snapshots
// ---------------------------------------------------------------------------
router.get('/prune-candidates', async (c) => {
  const assets = await loadSnapshots(c)

  // Determine which source assets still exist (for orphan detection).
  const sourceIds = [...new Set(assets.map((a) => a.source_asset_id).filter((s): s is string => !!s))]
  const liveSources = new Set<string>()
  if (sourceIds.length > 0) {
    const present = await db
      .select({ id: storage_assets.id })
      .from(storage_assets)
      .where(inArray(storage_assets.id, sourceIds))
    for (const r of present) liveSources.add(r.id)
  }

  // Access patterns for the snapshots themselves (cold/never => prunable).
  const assetIds = assets.map((a) => a.id)
  const accessByAsset = new Map<string, typeof access_patterns.$inferSelect>()
  if (assetIds.length > 0) {
    const ap = await db.select().from(access_patterns).where(inArray(access_patterns.asset_id, assetIds))
    for (const p of ap) accessByAsset.set(p.asset_id, p)
  }

  // Group by source to find redundant (superseded) snapshots within a chain.
  const chains = new Map<string, Asset[]>()
  for (const a of assets) {
    if (!a.source_asset_id) continue
    const list = chains.get(a.source_asset_id)
    if (list) list.push(a)
    else chains.set(a.source_asset_id, [a])
  }
  // Within each chain, every full snapshot older than the most recent full
  // snapshot is redundant (superseded by a newer full backup).
  const redundantIds = new Set<string>()
  for (const members of chains.values()) {
    const fulls = members
      .filter((a) => !a.is_incremental)
      .sort((x, y) => {
        const tx = x.asset_created_at ? new Date(x.asset_created_at).getTime() : 0
        const ty = y.asset_created_at ? new Date(y.asset_created_at).getTime() : 0
        return ty - tx
      })
    for (let i = 1; i < fulls.length; i++) redundantIds.add(fulls[i].id)
  }

  const candidates: Array<{
    id: string
    name: string
    asset_type: string
    source_asset_id: string | null
    size_bytes: number
    size_gb: number
    monthly_cost: number
    reasons: string[]
    age_days: number | null
    idle_days: number | null
  }> = []

  for (const a of assets) {
    const reasons: string[] = []

    // Orphaned: declares a source that no longer exists.
    if (a.source_asset_id && !liveSources.has(a.source_asset_id)) {
      reasons.push('orphaned')
    }

    // Redundant: superseded by a newer full backup in the same chain.
    if (redundantIds.has(a.id)) reasons.push('redundant')

    // Stale: not modified within the staleness window, or access pattern cold.
    const idle = daysSince(a.last_modified_at)
    const ap = accessByAsset.get(a.id)
    const cold = ap ? ap.temperature === 'cold' || ap.temperature === 'frozen' || ap.temperature === 'never' : false
    if ((idle !== null && idle >= STALE_DAYS) || cold) reasons.push('stale')

    if (reasons.length > 0) {
      candidates.push({
        id: a.id,
        name: a.name,
        asset_type: a.asset_type,
        source_asset_id: a.source_asset_id ?? null,
        size_bytes: num(a.size_bytes),
        size_gb: num(a.size_bytes) / 1_073_741_824,
        monthly_cost: num(a.monthly_cost),
        reasons,
        age_days: daysSince(a.asset_created_at),
        idle_days: idle,
      })
    }
  }

  candidates.sort((x, y) => y.monthly_cost - x.monthly_cost)
  const total_monthly = candidates.reduce((s, x) => s + x.monthly_cost, 0)

  return c.json({ candidates, total_monthly })
})

export default router
