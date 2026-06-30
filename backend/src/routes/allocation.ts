import { Hono } from 'hono'
import { db } from '../db/index.js'
import * as tables from '../db/schema.js'
import { eq, desc } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — recoverable + spend by tag dimension
// query: dimension (a tag key, e.g. "team" | "env" | "cost_center"); defaults
//        to the most common tag key in the estate.
//
// Spend comes from storage_assets.monthly_cost grouped by the value of the tag
// `dimension` on each asset. Recoverable comes from recovery_actions joined to
// their asset's tag value.
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? undefined
  let dimension = c.req.query('dimension') ?? undefined

  const assets = userId
    ? await db
        .select()
        .from(tables.storage_assets)
        .where(eq(tables.storage_assets.user_id, userId))
    : await db.select().from(tables.storage_assets)

  // Determine default dimension = most frequently used tag key.
  if (!dimension) {
    const keyFreq = new Map<string, number>()
    for (const a of assets) {
      const t = (a.tags ?? {}) as Record<string, string>
      for (const k of Object.keys(t)) keyFreq.set(k, (keyFreq.get(k) ?? 0) + 1)
    }
    dimension = [...keyFreq.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'team'
  }

  const actions = userId
    ? await db
        .select()
        .from(tables.recovery_actions)
        .where(eq(tables.recovery_actions.user_id, userId))
    : await db.select().from(tables.recovery_actions)

  // asset_id -> tag value for the chosen dimension
  const assetTagValue = new Map<string, string>()
  const assetSpend = new Map<string, number>()
  const assetBytes = new Map<string, number>()
  for (const a of assets) {
    const t = (a.tags ?? {}) as Record<string, string>
    assetTagValue.set(a.id, t[dimension] ?? '(untagged)')
    assetSpend.set(a.id, a.monthly_cost ?? 0)
    assetBytes.set(a.id, a.size_bytes ?? 0)
  }

  const rowsMap = new Map<
    string,
    { value: string; spend: number; recoverable_monthly: number; recoverable_annual: number; asset_count: number; data_gb: number }
  >()

  const ensure = (value: string) => {
    let r = rowsMap.get(value)
    if (!r) {
      r = { value, spend: 0, recoverable_monthly: 0, recoverable_annual: 0, asset_count: 0, data_gb: 0 }
      rowsMap.set(value, r)
    }
    return r
  }

  for (const a of assets) {
    const value = assetTagValue.get(a.id)!
    const r = ensure(value)
    r.spend += a.monthly_cost ?? 0
    r.asset_count += 1
    r.data_gb += (a.size_bytes ?? 0) / (1024 * 1024 * 1024)
  }

  for (const act of actions) {
    const value = (act.asset_id && assetTagValue.get(act.asset_id)) || '(untagged)'
    const r = ensure(value)
    r.recoverable_monthly += act.monthly_savings ?? 0
    r.recoverable_annual += act.annual_savings ?? 0
  }

  const rows = [...rowsMap.values()].sort((a, b) => b.spend - a.spend)
  return c.json({ dimension, rows })
})

// ---------------------------------------------------------------------------
// GET /untagged — untagged assets / cost-allocation gaps
// ---------------------------------------------------------------------------
router.get('/untagged', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? undefined

  const assets = userId
    ? await db
        .select()
        .from(tables.storage_assets)
        .where(eq(tables.storage_assets.user_id, userId))
        .orderBy(desc(tables.storage_assets.monthly_cost))
    : await db
        .select()
        .from(tables.storage_assets)
        .orderBy(desc(tables.storage_assets.monthly_cost))

  const untagged = assets.filter((a) => {
    const t = (a.tags ?? {}) as Record<string, string>
    return Object.keys(t).length === 0
  })

  const untaggedSpend = untagged.reduce((s, a) => s + (a.monthly_cost ?? 0), 0)
  const totalSpend = assets.reduce((s, a) => s + (a.monthly_cost ?? 0), 0)

  return c.json({
    assets: untagged.map((a) => ({
      id: a.id,
      name: a.name,
      asset_type: a.asset_type,
      provider: a.provider,
      region: a.region,
      current_tier: a.current_tier,
      monthly_cost: a.monthly_cost,
      account_id: a.account_id,
    })),
    untagged_spend: untaggedSpend,
    total_spend: totalSpend,
    untagged_count: untagged.length,
    coverage_pct: totalSpend > 0 ? ((totalSpend - untaggedSpend) / totalSpend) * 100 : 100,
  })
})

// ---------------------------------------------------------------------------
// GET /tags — list tag dimension values
// ---------------------------------------------------------------------------
router.get('/tags', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? undefined

  const rows = userId
    ? await db
        .select()
        .from(tables.tags)
        .where(eq(tables.tags.user_id, userId))
        .orderBy(tables.tags.key, tables.tags.value)
    : await db.select().from(tables.tags).orderBy(tables.tags.key, tables.tags.value)

  return c.json(rows)
})

export default router
