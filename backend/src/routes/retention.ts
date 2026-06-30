import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { retention_policies, storage_assets, accounts } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const BYTES_PER_GB = 1024 * 1024 * 1024

const policySchema = z.object({
  name: z.string().min(1),
  scope_type: z.enum(['account', 'tag', 'asset_type', 'all']).default('account'),
  scope_value: z.string().nullable().optional(),
  max_age_days: z.number().int().positive().nullable().optional(),
  transition_after_days: z.number().int().positive().nullable().optional(),
  transition_to_tier: z.string().nullable().optional(),
  delete_after_days: z.number().int().positive().nullable().optional(),
  enabled: z.boolean().optional().default(true),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ageInDays(asset: { asset_created_at: Date | null; created_at: Date }): number {
  const base = asset.asset_created_at ?? asset.created_at
  const ms = Date.now() - new Date(base).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

/** Does a policy apply to a given asset? */
function policyApplies(
  policy: typeof retention_policies.$inferSelect,
  asset: typeof storage_assets.$inferSelect,
): boolean {
  if (!policy.enabled) return false
  switch (policy.scope_type) {
    case 'all':
      return true
    case 'account':
      return !policy.scope_value || policy.scope_value === asset.account_id
    case 'asset_type':
      return policy.scope_value === asset.asset_type
    case 'tag': {
      if (!policy.scope_value) return false
      const [k, v] = policy.scope_value.split(':')
      const tags = (asset.tags ?? {}) as Record<string, string>
      return v === undefined ? k in tags : tags[k] === v
    }
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// GET /policies — public — list retention policies
// ---------------------------------------------------------------------------
router.get('/policies', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(retention_policies)
    .where(eq(retention_policies.user_id, userId))
    .orderBy(retention_policies.created_at)
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /reconcile — public — over-retention + policy-gap findings + coverage
// ---------------------------------------------------------------------------
router.get('/reconcile', async (c) => {
  const userId = getUserId(c)
  if (!userId) {
    return c.json({ violations: [], gaps: [], coverage_pct: 0, recoverable_monthly: 0 })
  }

  const policies = await db
    .select()
    .from(retention_policies)
    .where(eq(retention_policies.user_id, userId))

  const assets = await db
    .select()
    .from(storage_assets)
    .where(eq(storage_assets.user_id, userId))

  const enabledPolicies = policies.filter((p) => p.enabled)

  const violations: Array<{
    asset_id: string
    account_id: string
    name: string
    asset_type: string
    policy_id: string
    policy_name: string
    violation_type: 'over_age' | 'should_transition' | 'should_delete'
    age_days: number
    limit_days: number
    detail: string
    target_tier: string | null
    monthly_savings: number
    annual_savings: number
  }> = []

  let coveredCount = 0
  const gaps: Array<{
    account_id: string | null
    scope: string
    asset_count: number
    uncovered_monthly: number
    detail: string
  }> = []

  // Track uncovered assets grouped by account for gap reporting.
  const uncoveredByAccount = new Map<string, { count: number; monthly: number }>()

  let recoverable_monthly = 0

  for (const asset of assets) {
    const applicable = enabledPolicies.filter((p) => policyApplies(p, asset))
    if (applicable.length === 0) {
      const key = asset.account_id
      const cur = uncoveredByAccount.get(key) ?? { count: 0, monthly: 0 }
      cur.count += 1
      cur.monthly += asset.monthly_cost ?? 0
      uncoveredByAccount.set(key, cur)
      continue
    }
    coveredCount += 1

    const age = ageInDays(asset)
    const sizeGb = (asset.size_bytes ?? 0) / BYTES_PER_GB
    const cost = asset.monthly_cost ?? 0

    for (const p of applicable) {
      // Over-retention: asset older than max_age_days -> should be deleted.
      if (p.max_age_days != null && age > p.max_age_days) {
        const saving = cost
        recoverable_monthly += saving
        violations.push({
          asset_id: asset.id,
          account_id: asset.account_id,
          name: asset.name,
          asset_type: asset.asset_type,
          policy_id: p.id,
          policy_name: p.name,
          violation_type: 'over_age',
          age_days: age,
          limit_days: p.max_age_days,
          detail: `Asset is ${age}d old, exceeding max age ${p.max_age_days}d under "${p.name}".`,
          target_tier: null,
          monthly_savings: Number(saving.toFixed(2)),
          annual_savings: Number((saving * 12).toFixed(2)),
        })
      }
      // Should delete (explicit delete_after_days).
      else if (p.delete_after_days != null && age > p.delete_after_days) {
        const saving = cost
        recoverable_monthly += saving
        violations.push({
          asset_id: asset.id,
          account_id: asset.account_id,
          name: asset.name,
          asset_type: asset.asset_type,
          policy_id: p.id,
          policy_name: p.name,
          violation_type: 'should_delete',
          age_days: age,
          limit_days: p.delete_after_days,
          detail: `Asset is ${age}d old, past delete-after ${p.delete_after_days}d under "${p.name}".`,
          target_tier: null,
          monthly_savings: Number(saving.toFixed(2)),
          annual_savings: Number((saving * 12).toFixed(2)),
        })
      }
      // Should transition to a cheaper tier.
      else if (
        p.transition_after_days != null &&
        age > p.transition_after_days &&
        p.transition_to_tier &&
        asset.current_tier !== p.transition_to_tier
      ) {
        // Estimate transition savings as a tier-delta fraction of current cost.
        const saving = estimateTransitionSaving(cost, asset.current_tier, p.transition_to_tier)
        recoverable_monthly += saving
        violations.push({
          asset_id: asset.id,
          account_id: asset.account_id,
          name: asset.name,
          asset_type: asset.asset_type,
          policy_id: p.id,
          policy_name: p.name,
          violation_type: 'should_transition',
          age_days: age,
          limit_days: p.transition_after_days,
          detail: `Asset is ${age}d old; "${p.name}" requires transition ${asset.current_tier} -> ${p.transition_to_tier} after ${p.transition_after_days}d (${sizeGb.toFixed(1)} GB).`,
          target_tier: p.transition_to_tier,
          monthly_savings: Number(saving.toFixed(2)),
          annual_savings: Number((saving * 12).toFixed(2)),
        })
      }
    }
  }

  // Build gap findings from the uncovered map, attaching account names.
  if (uncoveredByAccount.size > 0) {
    const accountRows = await db
      .select()
      .from(accounts)
      .where(eq(accounts.user_id, userId))
    const nameById = new Map(accountRows.map((a) => [a.id, a.name]))
    for (const [accId, v] of uncoveredByAccount) {
      gaps.push({
        account_id: accId,
        scope: nameById.get(accId) ?? accId,
        asset_count: v.count,
        uncovered_monthly: Number(v.monthly.toFixed(2)),
        detail: `${v.count} asset(s) in ${nameById.get(accId) ?? accId} are not governed by any enabled retention policy.`,
      })
    }
    gaps.sort((a, b) => b.uncovered_monthly - a.uncovered_monthly)
  }

  const total = assets.length
  const coverage_pct = total === 0 ? 0 : Number(((coveredCount / total) * 100).toFixed(1))

  violations.sort((a, b) => b.monthly_savings - a.monthly_savings)

  return c.json({
    violations,
    gaps,
    coverage_pct,
    covered_assets: coveredCount,
    total_assets: total,
    recoverable_monthly: Number(recoverable_monthly.toFixed(2)),
    recoverable_annual: Number((recoverable_monthly * 12).toFixed(2)),
  })
})

/** Rough monthly saving when moving from one tier to a colder one. */
function estimateTransitionSaving(cost: number, fromTier: string, toTier: string): number {
  const rank: Record<string, number> = {
    hot: 1,
    warm: 0.55,
    cold: 0.3,
    archive: 0.12,
    'deep-archive': 0.05,
  }
  const from = rank[fromTier] ?? 1
  const to = rank[toTier] ?? from
  if (to >= from) return 0
  // Saving fraction is the proportional drop in per-GB storage rate.
  const frac = (from - to) / from
  return Math.max(0, cost * frac)
}

// ---------------------------------------------------------------------------
// POST /policies — auth — create policy
// ---------------------------------------------------------------------------
router.post('/policies', authMiddleware, zValidator('json', policySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(retention_policies)
    .values({
      user_id: userId,
      name: body.name,
      scope_type: body.scope_type,
      scope_value: body.scope_value ?? null,
      max_age_days: body.max_age_days ?? null,
      transition_after_days: body.transition_after_days ?? null,
      transition_to_tier: body.transition_to_tier ?? null,
      delete_after_days: body.delete_after_days ?? null,
      enabled: body.enabled,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /policies/:id — auth — update policy
// ---------------------------------------------------------------------------
router.put('/policies/:id', authMiddleware, zValidator('json', policySchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(retention_policies)
    .where(eq(retention_policies.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(retention_policies)
    .set({ ...body, updated_at: new Date() })
    .where(and(eq(retention_policies.id, id), eq(retention_policies.user_id, userId)))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /policies/:id — auth — delete policy
// ---------------------------------------------------------------------------
router.delete('/policies/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(retention_policies)
    .where(eq(retention_policies.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db
    .delete(retention_policies)
    .where(and(eq(retention_policies.id, id), eq(retention_policies.user_id, userId)))
  return c.json({ success: true })
})

export default router
