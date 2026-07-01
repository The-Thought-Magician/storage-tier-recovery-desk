import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  storage_assets,
  recovery_actions,
  realized_savings,
  findings,
  analysis_runs,
  accounts,
} from '../db/schema.js'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

const OPEN_STATUSES = new Set(['proposed', 'approved', 'in-progress'])

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Group a numeric metric by a string dimension into a sorted descending array.
function groupSum<T>(
  rows: T[],
  keyFn: (r: T) => string | null | undefined,
  valFn: (r: T) => number,
  countFn?: (r: T) => number,
): Array<{ key: string; value: number; count: number }> {
  const map = new Map<string, { value: number; count: number }>()
  for (const r of rows) {
    const k = keyFn(r) ?? 'unknown'
    const b = map.get(k) ?? { value: 0, count: 0 }
    b.value += valFn(r)
    b.count += countFn ? countFn(r) : 1
    map.set(k, b)
  }
  return [...map.entries()]
    .map(([key, { value, count }]) => ({ key, value: round2(value), count }))
    .sort((a, b) => b.value - a.value)
}

// ---------------------------------------------------------------------------
// GET / — KPIs + top opportunities (public)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)

  const assets = userId
    ? await db.select().from(storage_assets).where(eq(storage_assets.user_id, userId))
    : await db.select().from(storage_assets)
  const actions = userId
    ? await db.select().from(recovery_actions).where(eq(recovery_actions.user_id, userId))
    : await db.select().from(recovery_actions)
  const realized = userId
    ? await db.select().from(realized_savings).where(eq(realized_savings.user_id, userId))
    : await db.select().from(realized_savings)
  const findingRows = userId
    ? await db.select().from(findings).where(eq(findings.user_id, userId))
    : await db.select().from(findings)
  const accountRows = userId
    ? await db.select().from(accounts).where(eq(accounts.user_id, userId))
    : await db.select().from(accounts)

  const totalSpend = assets.reduce((s, a) => s + (a.monthly_cost ?? 0), 0)

  const openActions = actions.filter((a) => OPEN_STATUSES.has(a.status))
  const recoverableMonthly = openActions.reduce((s, a) => s + (a.monthly_savings ?? 0), 0)

  const doneActions = actions.filter((a) => a.status === 'done')
  const realizedMonthly = realized.reduce((s, r) => s + (r.realized_monthly ?? 0), 0)
  const modeledMonthly = realized.reduce((s, r) => s + (r.modeled_monthly ?? 0), 0)

  // Recovery rate: realized vs total addressable (realized + still-open recoverable).
  const addressable = realizedMonthly + recoverableMonthly
  const recoveryRate = addressable > 0 ? round2((realizedMonthly / addressable) * 100) : 0

  // Top opportunities: highest-priority open actions.
  const topOpportunities = [...openActions]
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
    .slice(0, 10)
    .map((a) => ({
      id: a.id,
      title: a.title,
      action_type: a.action_type,
      monthly_savings: round2(a.monthly_savings ?? 0),
      annual_savings: round2(a.annual_savings ?? 0),
      effort_score: a.effort_score,
      risk_score: a.risk_score,
      priority_score: round2(a.priority_score ?? 0),
      status: a.status,
      account_id: a.account_id,
      asset_id: a.asset_id,
    }))

  return c.json({
    kpis: {
      total_spend_monthly: round2(totalSpend),
      total_spend_annual: round2(totalSpend * 12),
      recoverable_monthly: round2(recoverableMonthly),
      recoverable_annual: round2(recoverableMonthly * 12),
      realized_monthly: round2(realizedMonthly),
      realized_annual: round2(realizedMonthly * 12),
      modeled_monthly: round2(modeledMonthly),
      recovery_rate_pct: recoveryRate,
      asset_count: assets.length,
      open_action_count: openActions.length,
      done_action_count: doneActions.length,
      recoverable_pct_of_spend:
        totalSpend > 0 ? round2((recoverableMonthly / totalSpend) * 100) : 0,
      // Aliases matching the dashboard page's field names.
      total_spend: round2(totalSpend),
      total_recoverable: round2(recoverableMonthly),
      recovery_rate: recoveryRate,
      findings_count: findingRows.length,
      actions_count: openActions.length,
      accounts_count: accountRows.length,
      assets_count: assets.length,
    },
    top_opportunities: topOpportunities,
  })
})

// ---------------------------------------------------------------------------
// GET /breakdown — spend + recoverable across dimensions (public)
// ---------------------------------------------------------------------------
router.get('/breakdown', async (c) => {
  const userId = getUserId(c)

  const assets = userId
    ? await db.select().from(storage_assets).where(eq(storage_assets.user_id, userId))
    : await db.select().from(storage_assets)
  const actions = userId
    ? await db.select().from(recovery_actions).where(eq(recovery_actions.user_id, userId))
    : await db.select().from(recovery_actions)
  const accountRows = userId
    ? await db.select().from(accounts).where(eq(accounts.user_id, userId))
    : await db.select().from(accounts)

  const accountName = new Map(accountRows.map((a) => [a.id, a.name]))
  const assetById = new Map(assets.map((a) => [a.id, a]))
  const openActions = actions.filter((a) => OPEN_STATUSES.has(a.status))

  // Spend-side breakdowns (by storage assets).
  const byProviderSpend = groupSum(assets, (a) => a.provider, (a) => a.monthly_cost ?? 0)
  const byTierSpend = groupSum(assets, (a) => a.current_tier, (a) => a.monthly_cost ?? 0)
  const byRegionSpend = groupSum(assets, (a) => a.region, (a) => a.monthly_cost ?? 0)
  const byAccountSpend = groupSum(assets, (a) => a.account_id, (a) => a.monthly_cost ?? 0)

  // Recoverable-side breakdowns (by open recovery actions).
  const recoverByAccount = new Map<string, number>()
  for (const a of openActions) {
    const k = a.account_id ?? 'unknown'
    recoverByAccount.set(k, (recoverByAccount.get(k) ?? 0) + (a.monthly_savings ?? 0))
  }
  const recoverByProvider = new Map<string, number>()
  const recoverByTier = new Map<string, number>()
  const recoverByRegion = new Map<string, number>()
  for (const act of openActions) {
    const asset = act.asset_id ? assetById.get(act.asset_id) : undefined
    const provider = asset?.provider ?? 'unknown'
    const tier = asset?.current_tier ?? 'unknown'
    const region = asset?.region ?? 'unknown'
    recoverByProvider.set(provider, (recoverByProvider.get(provider) ?? 0) + (act.monthly_savings ?? 0))
    recoverByTier.set(tier, (recoverByTier.get(tier) ?? 0) + (act.monthly_savings ?? 0))
    recoverByRegion.set(region, (recoverByRegion.get(region) ?? 0) + (act.monthly_savings ?? 0))
  }

  const byActionType = groupSum(openActions, (a) => a.action_type, (a) => a.monthly_savings ?? 0)
  const byRisk = groupSum(
    openActions,
    (a) => `risk-${a.risk_score ?? 'unknown'}`,
    (a) => a.monthly_savings ?? 0,
  )

  const mergeSpendRecover = (
    spend: Array<{ key: string; value: number; count: number }>,
    recover: Map<string, number>,
  ) => {
    const keys = new Set<string>([...spend.map((s) => s.key), ...recover.keys()])
    return [...keys]
      .map((key) => {
        const s = spend.find((x) => x.key === key)
        return {
          key,
          spend: s?.value ?? 0,
          recoverable: round2(recover.get(key) ?? 0),
          count: s?.count ?? 0,
        }
      })
      .sort((a, b) => b.spend - a.spend)
  }

  return c.json({
    by_provider: mergeSpendRecover(byProviderSpend, recoverByProvider),
    by_tier: mergeSpendRecover(byTierSpend, recoverByTier),
    by_region: mergeSpendRecover(byRegionSpend, recoverByRegion),
    by_account: mergeSpendRecover(byAccountSpend, recoverByAccount).map((r) => ({
      ...r,
      name: accountName.get(r.key) ?? r.key,
    })),
    by_action_type: byActionType.map((r) => ({
      key: r.key,
      recoverable: r.value,
      count: r.count,
    })),
    by_risk: byRisk
      .map((r) => ({ key: r.key, recoverable: r.value, count: r.count }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  })
})

// ---------------------------------------------------------------------------
// GET /trend — spend/recoverable/realized over time (public)
// ---------------------------------------------------------------------------
router.get('/trend', async (c) => {
  const userId = getUserId(c)

  const runs = userId
    ? await db
        .select()
        .from(analysis_runs)
        .where(eq(analysis_runs.user_id, userId))
        .orderBy(desc(analysis_runs.created_at))
    : await db.select().from(analysis_runs).orderBy(desc(analysis_runs.created_at))
  const realized = userId
    ? await db.select().from(realized_savings).where(eq(realized_savings.user_id, userId))
    : await db.select().from(realized_savings)
  const assets = userId
    ? await db.select().from(storage_assets).where(eq(storage_assets.user_id, userId))
    : await db.select().from(storage_assets)

  const totalSpend = assets.reduce((s, a) => s + (a.monthly_cost ?? 0), 0)

  // Bucket by day (UTC). Recoverable comes from each analysis run; realized from
  // realized_savings keyed on realized_at. Current spend is shown as a flat line.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const buckets = new Map<
    string,
    { recoverable: number; realized: number; runs: number; spend: number }
  >()

  const ensure = (k: string) => {
    let b = buckets.get(k)
    if (!b) {
      b = { recoverable: 0, realized: 0, runs: 0, spend: totalSpend }
      buckets.set(k, b)
    }
    return b
  }

  for (const r of runs) {
    if (!r.created_at) continue
    const k = dayKey(new Date(r.created_at))
    const b = ensure(k)
    // Use the latest run's recoverable figure for the day (runs are desc-ordered).
    if (b.runs === 0) b.recoverable = r.total_recoverable_monthly ?? 0
    b.runs += 1
  }
  for (const r of realized) {
    if (!r.realized_at) continue
    const k = dayKey(new Date(r.realized_at))
    const b = ensure(k)
    b.realized += r.realized_monthly ?? 0
  }

  const points = [...buckets.entries()]
    .map(([date, b]) => ({
      date,
      spend_monthly: round2(b.spend),
      recoverable_monthly: round2(b.recoverable),
      realized_monthly: round2(b.realized),
      runs: b.runs,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return c.json({ points })
})

export default router
