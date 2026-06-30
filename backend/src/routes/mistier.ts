import { Hono } from 'hono'
import { db } from '../db/index.js'
import { findings, storage_assets } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// Mis-tier detector findings.
//
// Surfaces findings produced by the analysis engine with finding_type
// 'mistier'. Each finding carries gross monthly savings; the per-asset NET
// savings subtracts an amortized retrieval/early-delete carrying cost (pulled
// from finding.metadata when present) so the worksheet reflects real recovery.
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Net monthly savings = gross monthly_savings minus amortized retrieval cost. */
function netMonthly(f: { monthly_savings: number | null; metadata: Record<string, unknown> | null }): number {
  const gross = num(f.monthly_savings)
  const meta = (f.metadata ?? {}) as Record<string, unknown>
  // One-time costs are amortized over the assumed retention horizon (default 12 months).
  const months = Math.max(1, num(meta.amortize_months) || 12)
  const retrievalCost = num(meta.retrieval_cost)
  const earlyDelete = num(meta.early_delete_penalty)
  const oneTime = retrievalCost + earlyDelete
  return gross - oneTime / months
}

// ---------------------------------------------------------------------------
// GET / — public — mis-tier findings list with per-asset net savings
//   query: account_id
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const accountId = c.req.query('account_id')
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')

  const conds = [eq(findings.finding_type, 'mistier')]
  if (accountId) conds.push(eq(findings.account_id, accountId))
  if (userId) conds.push(eq(findings.user_id, userId))

  const rows = await db
    .select({
      finding: findings,
      asset: storage_assets,
    })
    .from(findings)
    .leftJoin(storage_assets, eq(findings.asset_id, storage_assets.id))
    .where(and(...conds))
    .orderBy(desc(findings.priority_score), desc(findings.monthly_savings))

  const out = rows.map(({ finding, asset }) => {
    const net_monthly_savings = netMonthly(finding)
    return {
      ...finding,
      net_monthly_savings,
      net_annual_savings: net_monthly_savings * 12,
      asset: asset
        ? {
            id: asset.id,
            name: asset.name,
            asset_type: asset.asset_type,
            provider: asset.provider,
            region: asset.region,
            current_tier: asset.current_tier,
            size_bytes: asset.size_bytes,
            monthly_cost: asset.monthly_cost,
          }
        : null,
    }
  })

  return c.json(out)
})

// ---------------------------------------------------------------------------
// GET /summary — public — total mis-tier recoverable + count
// ---------------------------------------------------------------------------
router.get('/summary', async (c) => {
  const accountId = c.req.query('account_id')
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')

  const conds = [eq(findings.finding_type, 'mistier')]
  if (accountId) conds.push(eq(findings.account_id, accountId))
  if (userId) conds.push(eq(findings.user_id, userId))

  const rows = await db.select().from(findings).where(and(...conds))

  let total_monthly = 0
  for (const f of rows) total_monthly += netMonthly(f)
  const total_annual = total_monthly * 12

  return c.json({
    total_monthly,
    total_annual,
    count: rows.length,
  })
})

export default router
