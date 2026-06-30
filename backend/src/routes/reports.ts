import { Hono } from 'hono'
import { db } from '../db/index.js'
import * as tables from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function bytesToGb(bytes: number): number {
  return (bytes ?? 0) / (1024 * 1024 * 1024)
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Array.from(
    rows.reduce<Set<string>>((set, r) => {
      Object.keys(r).forEach((k) => set.add(k))
      return set
    }, new Set<string>()),
  )
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// GET /summary — report payload (scope = workspace | account | cycle)
// query: scope (default workspace), id (account_id or cycle_id when scoped)
// ---------------------------------------------------------------------------
router.get('/summary', async (c) => {
  const scope = (c.req.query('scope') ?? 'workspace').toLowerCase()
  const id = c.req.query('id') ?? undefined
  // public read scoped to a user_id if X-User-Id present, else global
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? undefined

  const assetWhere = userId ? eq(tables.storage_assets.user_id, userId) : undefined
  const actionWhere = userId ? eq(tables.recovery_actions.user_id, userId) : undefined

  if (scope === 'account') {
    if (!id) return c.json({ error: 'id (account_id) is required for scope=account' }, 400)
    const [account] = await db
      .select()
      .from(tables.accounts)
      .where(eq(tables.accounts.id, id))
    if (!account) return c.json({ error: 'Account not found' }, 404)

    const assets = await db
      .select()
      .from(tables.storage_assets)
      .where(eq(tables.storage_assets.account_id, id))
    const actions = await db
      .select()
      .from(tables.recovery_actions)
      .where(eq(tables.recovery_actions.account_id, id))

    const totalSpend = assets.reduce((s, a) => s + (a.monthly_cost ?? 0), 0)
    const totalBytes = assets.reduce((s, a) => s + (a.size_bytes ?? 0), 0)
    const recoverableMonthly = actions.reduce((s, a) => s + (a.monthly_savings ?? 0), 0)
    const realizedRows = actions.length
      ? await db.select().from(tables.realized_savings)
      : []
    const actionIds = new Set(actions.map((a) => a.id))
    const realizedMonthly = realizedRows
      .filter((r) => actionIds.has(r.action_id))
      .reduce((s, r) => s + (r.realized_monthly ?? 0), 0)

    return c.json({
      report: {
        scope: 'account',
        generated_at: new Date().toISOString(),
        account,
        totals: {
          total_spend: totalSpend,
          total_recoverable_monthly: recoverableMonthly,
          total_recoverable_annual: recoverableMonthly * 12,
          realized_monthly: realizedMonthly,
          asset_count: assets.length,
          total_data_gb: bytesToGb(totalBytes),
          action_count: actions.length,
        },
        by_action_type: groupBy(actions, (a) => a.action_type),
        by_status: groupBy(actions, (a) => a.status),
      },
    })
  }

  if (scope === 'cycle') {
    if (!id) return c.json({ error: 'id (cycle_id) is required for scope=cycle' }, 400)
    const [cycle] = await db
      .select()
      .from(tables.recovery_cycles)
      .where(eq(tables.recovery_cycles.id, id))
    if (!cycle) return c.json({ error: 'Cycle not found' }, 404)

    const actions = await db
      .select()
      .from(tables.recovery_actions)
      .where(eq(tables.recovery_actions.cycle_id, id))
    const realized = await db
      .select()
      .from(tables.realized_savings)
      .where(eq(tables.realized_savings.cycle_id, id))

    const modeledMonthly = actions.reduce((s, a) => s + (a.monthly_savings ?? 0), 0)
    const realizedMonthly = realized.reduce((s, r) => s + (r.realized_monthly ?? 0), 0)
    const target = cycle.target_monthly_savings ?? 0
    const progressPct = target > 0 ? Math.min(100, (realizedMonthly / target) * 100) : 0

    return c.json({
      report: {
        scope: 'cycle',
        generated_at: new Date().toISOString(),
        cycle,
        totals: {
          target_monthly_savings: target,
          modeled_monthly: modeledMonthly,
          modeled_annual: modeledMonthly * 12,
          realized_monthly: realizedMonthly,
          variance: realizedMonthly - modeledMonthly,
          progress_pct: progressPct,
          action_count: actions.length,
        },
        by_action_type: groupBy(actions, (a) => a.action_type),
        by_status: groupBy(actions, (a) => a.status),
      },
    })
  }

  // workspace scope (default)
  const assets = await db.select().from(tables.storage_assets).where(assetWhere)
  const actions = await db.select().from(tables.recovery_actions).where(actionWhere)
  const realized = userId
    ? await db
        .select()
        .from(tables.realized_savings)
        .where(eq(tables.realized_savings.user_id, userId))
    : await db.select().from(tables.realized_savings)
  const findings = userId
    ? await db.select().from(tables.findings).where(eq(tables.findings.user_id, userId))
    : await db.select().from(tables.findings)

  const totalSpend = assets.reduce((s, a) => s + (a.monthly_cost ?? 0), 0)
  const totalBytes = assets.reduce((s, a) => s + (a.size_bytes ?? 0), 0)
  const recoverableMonthly = actions.reduce((s, a) => s + (a.monthly_savings ?? 0), 0)
  const realizedMonthly = realized.reduce((s, r) => s + (r.realized_monthly ?? 0), 0)
  const recoveryRate = recoverableMonthly > 0 ? (realizedMonthly / recoverableMonthly) * 100 : 0

  return c.json({
    report: {
      scope: 'workspace',
      generated_at: new Date().toISOString(),
      totals: {
        total_spend: totalSpend,
        total_recoverable_monthly: recoverableMonthly,
        total_recoverable_annual: recoverableMonthly * 12,
        realized_monthly: realizedMonthly,
        realized_annual: realizedMonthly * 12,
        recovery_rate_pct: recoveryRate,
        asset_count: assets.length,
        total_data_gb: bytesToGb(totalBytes),
        finding_count: findings.length,
        action_count: actions.length,
      },
      by_provider: groupSpend(assets, (a) => a.provider),
      by_tier: groupSpend(assets, (a) => a.current_tier),
      by_finding_type: groupBy(findings, (f) => f.finding_type),
      by_action_status: groupBy(actions, (a) => a.status),
    },
  })
})

function groupBy<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = key(r) ?? 'unknown'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([k, count]) => ({ key: k, count }))
}

function groupSpend(
  assets: Array<{ monthly_cost: number | null; size_bytes: number | null }>,
  key: (a: { provider: string; current_tier: string }) => string,
) {
  const m = new Map<string, { spend: number; count: number; data_gb: number }>()
  for (const a of assets as any[]) {
    const k = key(a) ?? 'unknown'
    const cur = m.get(k) ?? { spend: 0, count: 0, data_gb: 0 }
    cur.spend += a.monthly_cost ?? 0
    cur.count += 1
    cur.data_gb += bytesToGb(a.size_bytes ?? 0)
    m.set(k, cur)
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, ...v }))
}

// ---------------------------------------------------------------------------
// GET /export — CSV/JSON export
// query: kind = worksheet | findings | inventory (default worksheet)
//        format = csv | json (default csv)
// ---------------------------------------------------------------------------
router.get('/export', async (c) => {
  const kind = (c.req.query('kind') ?? 'worksheet').toLowerCase()
  const format = (c.req.query('format') ?? 'csv').toLowerCase()
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? undefined

  let rows: Record<string, unknown>[] = []

  if (kind === 'findings') {
    const data = userId
      ? await db
          .select()
          .from(tables.findings)
          .where(eq(tables.findings.user_id, userId))
          .orderBy(desc(tables.findings.priority_score))
      : await db.select().from(tables.findings).orderBy(desc(tables.findings.priority_score))
    rows = data.map((f) => ({
      id: f.id,
      finding_type: f.finding_type,
      title: f.title,
      detail: f.detail,
      recommended_action: f.recommended_action,
      target_tier: f.target_tier,
      monthly_savings: f.monthly_savings,
      annual_savings: f.annual_savings,
      effort_score: f.effort_score,
      risk_score: f.risk_score,
      priority_score: f.priority_score,
      confidence: f.confidence,
      account_id: f.account_id,
      asset_id: f.asset_id,
      created_at: f.created_at,
    }))
  } else if (kind === 'inventory') {
    const data = userId
      ? await db
          .select()
          .from(tables.storage_assets)
          .where(eq(tables.storage_assets.user_id, userId))
          .orderBy(desc(tables.storage_assets.monthly_cost))
      : await db
          .select()
          .from(tables.storage_assets)
          .orderBy(desc(tables.storage_assets.monthly_cost))
    rows = data.map((a) => ({
      id: a.id,
      name: a.name,
      asset_type: a.asset_type,
      provider: a.provider,
      region: a.region,
      current_tier: a.current_tier,
      size_gb: bytesToGb(a.size_bytes ?? 0),
      object_count: a.object_count,
      monthly_cost: a.monthly_cost,
      attached: a.attached,
      account_id: a.account_id,
      tags: a.tags,
      created_at: a.created_at,
    }))
  } else {
    // worksheet (default)
    const data = userId
      ? await db
          .select()
          .from(tables.recovery_actions)
          .where(eq(tables.recovery_actions.user_id, userId))
          .orderBy(desc(tables.recovery_actions.priority_score))
      : await db
          .select()
          .from(tables.recovery_actions)
          .orderBy(desc(tables.recovery_actions.priority_score))
    rows = data.map((a) => ({
      id: a.id,
      action_type: a.action_type,
      title: a.title,
      status: a.status,
      owner: a.owner,
      monthly_savings: a.monthly_savings,
      annual_savings: a.annual_savings,
      effort_score: a.effort_score,
      risk_score: a.risk_score,
      priority_score: a.priority_score,
      account_id: a.account_id,
      asset_id: a.asset_id,
      cycle_id: a.cycle_id,
      notes: a.notes,
      created_at: a.created_at,
    }))
  }

  if (format === 'json') {
    c.header('Content-Disposition', `attachment; filename="${kind}-export.json"`)
    return c.json({ kind, count: rows.length, rows })
  }

  const csv = toCsv(rows)
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${kind}-export.csv"`)
  return c.body(csv)
})

export default router
