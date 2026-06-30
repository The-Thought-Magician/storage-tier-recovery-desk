import { Hono } from 'hono'
import { db } from '../db/index.js'
import { access_patterns, storage_assets, activity_log } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Tier ordering used for the heatmap axes.
const TIERS = ['hot', 'warm', 'cold', 'archive', 'deep-archive']
const TEMPERATURES = ['hot', 'warm', 'cold', 'frozen', 'never']

// Derive a temperature + access score from raw access signals.
// access_score: 0 (cold/idle) .. 100 (very hot). Temperature is bucketed off it
// and the days-since-access signal.
function deriveAccess(p: {
  reads_30d: number | null
  reads_90d: number | null
  requests_30d: number | null
  retrieval_gb_30d: number | null
  days_since_access: number | null
  last_access_at: Date | null
}): { temperature: string; access_score: number } {
  const reads30 = p.reads_30d ?? 0
  const reads90 = p.reads_90d ?? 0
  const requests30 = p.requests_30d ?? 0
  const retrieval = p.retrieval_gb_30d ?? 0
  const days = p.days_since_access

  // never accessed at all
  if (days === null && reads90 === 0 && reads30 === 0 && requests30 === 0) {
    return { temperature: 'never', access_score: 0 }
  }

  // Weighted activity signal -> 0..100 via a saturating curve.
  const activity = reads30 * 1.0 + requests30 * 0.5 + reads90 * 0.2 + retrieval * 2.0
  let score = (activity / (activity + 20)) * 100

  // Recency penalty: stale access drags the score down.
  if (days !== null) {
    if (days > 365) score *= 0.05
    else if (days > 180) score *= 0.2
    else if (days > 90) score *= 0.45
    else if (days > 30) score *= 0.7
  }
  score = Math.round(Math.max(0, Math.min(100, score)) * 100) / 100

  let temperature: string
  const d = days ?? Infinity
  if (score >= 60 || (reads30 > 0 && d <= 30)) temperature = 'hot'
  else if (score >= 25 || d <= 90) temperature = 'warm'
  else if (score > 0 || d <= 365) temperature = 'cold'
  else if (reads90 > 0 || reads30 > 0) temperature = 'cold'
  else temperature = 'frozen'

  return { temperature, access_score: score }
}

// Public: list access patterns (query: account_id)
router.get('/', async (c) => {
  const account_id = c.req.query('account_id')
  const patterns = await db.select().from(access_patterns)
  if (!account_id) return c.json(patterns)

  // access_patterns has no account_id; resolve via owning asset.
  const assets = await db
    .select()
    .from(storage_assets)
    .where(eq(storage_assets.account_id, account_id))
  const assetIds = new Set(assets.map((a) => a.id))
  return c.json(patterns.filter((p) => assetIds.has(p.asset_id)))
})

// Public: temperature x tier heatmap matrix
router.get('/heatmap', async (c) => {
  const account_id = c.req.query('account_id')
  let assets = await db.select().from(storage_assets)
  if (account_id) assets = assets.filter((a) => a.account_id === account_id)
  const patterns = await db.select().from(access_patterns)

  const tierByAsset = new Map(assets.map((a) => [a.id, a.current_tier]))
  const sizeByAsset = new Map(assets.map((a) => [a.id, a]))

  // matrix[temperature][tier] = { count, monthly_cost, size_bytes }
  const matrix: Array<{
    temperature: string
    tier: string
    count: number
    monthly_cost: number
    size_bytes: number
  }> = []
  const index = new Map<string, number>()
  for (const temp of TEMPERATURES) {
    for (const tier of TIERS) {
      index.set(`${temp}|${tier}`, matrix.length)
      matrix.push({ temperature: temp, tier, count: 0, monthly_cost: 0, size_bytes: 0 })
    }
  }

  for (const p of patterns) {
    const tier = tierByAsset.get(p.asset_id)
    if (!tier) continue
    const key = `${p.temperature}|${tier}`
    const idx = index.get(key)
    if (idx === undefined) continue
    const asset = sizeByAsset.get(p.asset_id)
    matrix[idx].count += 1
    matrix[idx].monthly_cost += asset?.monthly_cost ?? 0
    matrix[idx].size_bytes += asset?.size_bytes ?? 0
  }

  return c.json({ matrix, tiers: TIERS, temperatures: TEMPERATURES })
})

// Auth: recompute temperature + access_score for all of the user's assets
router.post('/enrich', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const patterns = await db
    .select()
    .from(access_patterns)
    .where(eq(access_patterns.user_id, userId))

  let updated = 0
  for (const p of patterns) {
    const { temperature, access_score } = deriveAccess({
      reads_30d: p.reads_30d,
      reads_90d: p.reads_90d,
      requests_30d: p.requests_30d,
      retrieval_gb_30d: p.retrieval_gb_30d,
      days_since_access: p.days_since_access,
      last_access_at: p.last_access_at,
    })
    if (temperature !== p.temperature || access_score !== (p.access_score ?? 0)) {
      await db
        .update(access_patterns)
        .set({ temperature, access_score })
        .where(eq(access_patterns.id, p.id))
      updated += 1
    }
  }

  await db.insert(activity_log).values({
    user_id: userId,
    entity_type: 'access',
    entity_id: null,
    action: 'enriched',
    detail: { updated, evaluated: patterns.length },
  })

  return c.json({ updated })
})

export default router
