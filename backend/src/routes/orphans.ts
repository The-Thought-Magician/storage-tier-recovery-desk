import { Hono } from 'hono'
import { db } from '../db/index.js'
import { storage_assets, access_patterns } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Orphan detection
//
// An "orphan" is a storage asset that is paying for itself while delivering no
// value. We classify orphans into four types:
//   - orphaned_volume   : a volume that is detached (attached === false)
//   - abandoned_bucket   : a bucket with no reads in 90d (or no access record)
//   - multipart          : an incomplete multipart upload (asset_type multipart)
//   - orphaned_snapshot   : a snapshot/backup whose source asset no longer exists
//
// All reads are public; everything below is read-only over the DB.
// ---------------------------------------------------------------------------

const BYTES_PER_GB = 1024 * 1024 * 1024

type OrphanType =
  | 'orphaned_volume'
  | 'abandoned_bucket'
  | 'multipart'
  | 'orphaned_snapshot'

interface OrphanRow {
  asset_id: string
  account_id: string
  name: string
  asset_type: string
  provider: string
  region: string | null
  current_tier: string
  size_gb: number
  monthly_cost: number
  orphan_type: OrphanType
  reason: string
  detached_since: Date | null
  days_idle: number | null
  recommended_action: string
}

async function computeOrphans(userId: string): Promise<OrphanRow[]> {
  const assets = await db
    .select()
    .from(storage_assets)
    .where(eq(storage_assets.user_id, userId))

  const access = await db
    .select()
    .from(access_patterns)
    .where(eq(access_patterns.user_id, userId))

  const accessByAsset = new Map<string, typeof access[number]>()
  for (const a of access) accessByAsset.set(a.asset_id, a)

  // Set of asset ids that physically exist, to detect dangling snapshot sources.
  const existingIds = new Set(assets.map((a) => a.id))

  const orphans: OrphanRow[] = []

  for (const asset of assets) {
    const acc = accessByAsset.get(asset.id)
    const sizeGb = (asset.size_bytes ?? 0) / BYTES_PER_GB
    const cost = asset.monthly_cost ?? 0
    let orphan_type: OrphanType | null = null
    let reason = ''
    let recommended_action = 'delete-orphan'
    let days_idle: number | null = acc?.days_since_access ?? null

    if (asset.asset_type === 'volume' && asset.attached === false) {
      orphan_type = 'orphaned_volume'
      const since = asset.detached_since
        ? new Date(asset.detached_since).toISOString().slice(0, 10)
        : 'an unknown date'
      reason = `Volume detached since ${since}; still billed at ${cost.toFixed(2)}/mo.`
      recommended_action = 'delete-orphan'
    } else if (asset.asset_type === 'multipart') {
      orphan_type = 'multipart'
      reason = `Incomplete multipart upload occupying ${sizeGb.toFixed(2)} GB.`
      recommended_action = 'delete-orphan'
    } else if (
      asset.asset_type === 'snapshot' ||
      asset.asset_type === 'backup'
    ) {
      // Orphaned snapshot: declares a source that no longer exists in inventory.
      if (asset.source_asset_id && !existingIds.has(asset.source_asset_id)) {
        orphan_type = 'orphaned_snapshot'
        reason = `Snapshot/backup whose source asset (${asset.source_asset_id}) no longer exists.`
        recommended_action = 'prune-snapshot'
      }
    } else if (asset.asset_type === 'bucket') {
      // Abandoned bucket: no access record, or zero reads across 90d with a
      // long idle period.
      const reads90 = acc?.reads_90d ?? 0
      const reads30 = acc?.reads_30d ?? 0
      const idle = acc?.days_since_access ?? null
      const neverAccessed = !acc || (acc.temperature === 'never')
      if ((reads90 === 0 && reads30 === 0) || neverAccessed) {
        orphan_type = 'abandoned_bucket'
        days_idle = idle
        reason = neverAccessed
          ? 'Bucket never accessed; no recorded reads.'
          : `Bucket with zero reads in 90d${idle != null ? ` (idle ${idle}d)` : ''}.`
        recommended_action = 'delete-orphan'
      }
    }

    if (orphan_type) {
      orphans.push({
        asset_id: asset.id,
        account_id: asset.account_id,
        name: asset.name,
        asset_type: asset.asset_type,
        provider: asset.provider,
        region: asset.region,
        current_tier: asset.current_tier,
        size_gb: Number(sizeGb.toFixed(4)),
        monthly_cost: Number(cost.toFixed(2)),
        orphan_type,
        reason,
        detached_since: asset.detached_since,
        days_idle,
        recommended_action,
      })
    }
  }

  // Highest carrying cost first.
  orphans.sort((a, b) => b.monthly_cost - a.monthly_cost)
  return orphans
}

// GET / — public — orphaned volumes, abandoned buckets, multipart, orphaned snapshots
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ orphans: [], total_monthly: 0 })
  const accountId = c.req.query('account_id')
  let orphans = await computeOrphans(userId)
  if (accountId) orphans = orphans.filter((o) => o.account_id === accountId)
  const total_monthly = Number(
    orphans.reduce((sum, o) => sum + o.monthly_cost, 0).toFixed(2),
  )
  return c.json({ orphans, total_monthly, total_annual: Number((total_monthly * 12).toFixed(2)), count: orphans.length })
})

// GET /summary — public — counts by orphan type + recoverable
router.get('/summary', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ by_type: [], total_monthly: 0 })
  const accountId = c.req.query('account_id')
  let orphans = await computeOrphans(userId)
  if (accountId) orphans = orphans.filter((o) => o.account_id === accountId)

  const map = new Map<OrphanType, { count: number; monthly: number; size_gb: number }>()
  for (const o of orphans) {
    const cur = map.get(o.orphan_type) ?? { count: 0, monthly: 0, size_gb: 0 }
    cur.count += 1
    cur.monthly += o.monthly_cost
    cur.size_gb += o.size_gb
    map.set(o.orphan_type, cur)
  }

  const by_type = [...map.entries()]
    .map(([orphan_type, v]) => ({
      orphan_type,
      count: v.count,
      monthly_savings: Number(v.monthly.toFixed(2)),
      annual_savings: Number((v.monthly * 12).toFixed(2)),
      size_gb: Number(v.size_gb.toFixed(2)),
    }))
    .sort((a, b) => b.monthly_savings - a.monthly_savings)

  const total_monthly = Number(
    by_type.reduce((sum, t) => sum + t.monthly_savings, 0).toFixed(2),
  )
  return c.json({
    by_type,
    total_monthly,
    total_annual: Number((total_monthly * 12).toFixed(2)),
    count: orphans.length,
  })
})

export default router
