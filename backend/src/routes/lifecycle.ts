import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { lifecycle_models, storage_assets } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const BYTES_PER_GB = 1024 * 1024 * 1024

const ruleSchema = z.object({
  after_days: z.number().int().nonnegative(),
  from_tier: z.string().min(1),
  to_tier: z.string().min(1),
  expire: z.boolean().optional(),
})

const modelSchema = z.object({
  account_id: z.string().nullable().optional(),
  name: z.string().min(1),
  rules: z.array(ruleSchema).default([]),
})

// Relative per-GB storage rate by tier (used for simulated savings when the
// asset has a known monthly_cost we can proportionally re-rate).
const TIER_RATE: Record<string, number> = {
  hot: 1,
  warm: 0.55,
  cold: 0.3,
  archive: 0.12,
  'deep-archive': 0.05,
}

function ageInDays(asset: { asset_created_at: Date | null; created_at: Date }): number {
  const base = asset.asset_created_at ?? asset.created_at
  const ms = Date.now() - new Date(base).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

interface SimResult {
  simulated_monthly_savings: number
  simulated_assets_affected: number
  simulated_data_moved_gb: number
  affected: Array<{
    asset_id: string
    name: string
    from_tier: string
    to_tier: string | null
    expired: boolean
    size_gb: number
    monthly_savings: number
  }>
}

/**
 * Simulate a lifecycle model (un-applied) against the user's inventory, scoped
 * to the model's account if it has one. Each asset is run through the rules in
 * order; the first rule whose `after_days` the asset has exceeded and whose
 * `from_tier` matches the asset's current tier wins. `expire` rules recover the
 * full monthly cost; transition rules recover the proportional tier-rate drop.
 */
function simulate(
  model: { account_id: string | null; rules: typeof lifecycle_models.$inferSelect['rules'] },
  assets: Array<typeof storage_assets.$inferSelect>,
): SimResult {
  const rules = (model.rules ?? []).slice().sort((a, b) => a.after_days - b.after_days)
  const scoped = model.account_id
    ? assets.filter((a) => a.account_id === model.account_id)
    : assets

  let savings = 0
  let dataMovedGb = 0
  const affected: SimResult['affected'] = []

  for (const asset of scoped) {
    const age = ageInDays(asset)
    const sizeGb = (asset.size_bytes ?? 0) / BYTES_PER_GB
    const cost = asset.monthly_cost ?? 0

    // Pick the most aggressive (largest after_days) matching rule that applies.
    let chosen: (typeof rules)[number] | null = null
    for (const r of rules) {
      if (age >= r.after_days && r.from_tier === asset.current_tier) {
        chosen = r // later (larger after_days) rules overwrite earlier matches
      }
    }
    if (!chosen) continue

    if (chosen.expire) {
      const saving = cost
      savings += saving
      dataMovedGb += sizeGb
      affected.push({
        asset_id: asset.id,
        name: asset.name,
        from_tier: asset.current_tier,
        to_tier: null,
        expired: true,
        size_gb: Number(sizeGb.toFixed(4)),
        monthly_savings: Number(saving.toFixed(2)),
      })
    } else if (chosen.to_tier && chosen.to_tier !== asset.current_tier) {
      const from = TIER_RATE[asset.current_tier] ?? 1
      const to = TIER_RATE[chosen.to_tier] ?? from
      const frac = to >= from ? 0 : (from - to) / from
      const saving = Math.max(0, cost * frac)
      if (saving > 0) {
        savings += saving
        dataMovedGb += sizeGb
        affected.push({
          asset_id: asset.id,
          name: asset.name,
          from_tier: asset.current_tier,
          to_tier: chosen.to_tier,
          expired: false,
          size_gb: Number(sizeGb.toFixed(4)),
          monthly_savings: Number(saving.toFixed(2)),
        })
      }
    }
  }

  affected.sort((a, b) => b.monthly_savings - a.monthly_savings)

  return {
    simulated_monthly_savings: Number(savings.toFixed(2)),
    simulated_assets_affected: affected.length,
    simulated_data_moved_gb: Number(dataMovedGb.toFixed(2)),
    affected,
  }
}

// ---------------------------------------------------------------------------
// GET / — public — list lifecycle models
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const accountId = c.req.query('account_id')
  const rows = await db
    .select()
    .from(lifecycle_models)
    .where(eq(lifecycle_models.user_id, userId))
    .orderBy(desc(lifecycle_models.created_at))
  const filtered = accountId ? rows.filter((r) => r.account_id === accountId) : rows
  return c.json(filtered)
})

// ---------------------------------------------------------------------------
// GET /:id — public — model detail
// ---------------------------------------------------------------------------
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [model] = await db
    .select()
    .from(lifecycle_models)
    .where(eq(lifecycle_models.id, id))
  if (!model) return c.json({ error: 'Not found' }, 404)
  if (userId && model.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  return c.json(model)
})

// ---------------------------------------------------------------------------
// POST / — auth — create model
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', modelSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(lifecycle_models)
    .values({
      user_id: userId,
      account_id: body.account_id ?? null,
      name: body.name,
      rules: body.rules,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/simulate — auth — simulate model vs inventory (un-applied)
// ---------------------------------------------------------------------------
router.post('/:id/simulate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [model] = await db
    .select()
    .from(lifecycle_models)
    .where(eq(lifecycle_models.id, id))
  if (!model) return c.json({ error: 'Not found' }, 404)
  if (model.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const assets = await db
    .select()
    .from(storage_assets)
    .where(eq(storage_assets.user_id, userId))

  const result = simulate({ account_id: model.account_id, rules: model.rules }, assets)

  // Persist the simulation snapshot onto the model (modeled, NOT applied to assets).
  const [updated] = await db
    .update(lifecycle_models)
    .set({
      simulated_monthly_savings: result.simulated_monthly_savings,
      simulated_assets_affected: result.simulated_assets_affected,
      simulated_data_moved_gb: result.simulated_data_moved_gb,
      last_simulated_at: new Date(),
    })
    .where(and(eq(lifecycle_models.id, id), eq(lifecycle_models.user_id, userId)))
    .returning()

  return c.json({
    model: updated,
    simulated_monthly_savings: result.simulated_monthly_savings,
    simulated_annual_savings: Number((result.simulated_monthly_savings * 12).toFixed(2)),
    simulated_assets_affected: result.simulated_assets_affected,
    simulated_data_moved_gb: result.simulated_data_moved_gb,
    affected: result.affected,
  })
})

// ---------------------------------------------------------------------------
// DELETE /:id — auth — delete model
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(lifecycle_models)
    .where(eq(lifecycle_models.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db
    .delete(lifecycle_models)
    .where(and(eq(lifecycle_models.id, id), eq(lifecycle_models.user_id, userId)))
  return c.json({ success: true })
})

export default router
