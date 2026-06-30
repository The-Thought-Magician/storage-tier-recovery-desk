import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { recovery_actions } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Statuses that represent still-open opportunity (not yet realized or dropped).
const OPEN_STATUSES = new Set(['proposed', 'approved', 'in-progress'])

interface ActionRow {
  id: string
  title: string
  monthly_savings: number | null
  annual_savings: number | null
  effort_score: number | null
  risk_score: number | null
  priority_score: number | null
  status: string
  action_type: string
}

function sumScenario(rows: ActionRow[]) {
  const monthly = rows.reduce((s, r) => s + (r.monthly_savings ?? 0), 0)
  return {
    monthly,
    annual: monthly * 12,
    count: rows.length,
    action_ids: rows.map((r) => r.id),
  }
}

// ---------------------------------------------------------------------------
// GET / — scenario forecasts (low-risk / top-20 / full) (public)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  const all = userId
    ? ((await db
        .select()
        .from(recovery_actions)
        .where(eq(recovery_actions.user_id, userId))) as ActionRow[])
    : ((await db.select().from(recovery_actions)) as ActionRow[])

  // Only forecast over actionable (open) items.
  const open = all.filter((a) => OPEN_STATUSES.has(a.status))

  // Full: everything still open.
  const full = sumScenario(open)

  // Low-risk: risk_score <= 2 and effort_score <= 2.
  const lowRisk = sumScenario(
    open.filter((a) => (a.risk_score ?? 5) <= 2 && (a.effort_score ?? 5) <= 2),
  )

  // Top-20: the 20 highest-priority actions.
  const ranked = [...open].sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
  const top20 = sumScenario(ranked.slice(0, 20))

  return c.json({
    scenarios: [
      {
        key: 'low-risk',
        label: 'Low-risk quick wins',
        description: 'Actions with risk and effort scores of 2 or lower.',
        ...lowRisk,
      },
      {
        key: 'top-20',
        label: 'Top 20 by priority',
        description: 'The 20 highest-priority recovery actions.',
        ...top20,
      },
      {
        key: 'full',
        label: 'Full recovery',
        description: 'Every open recovery action realized.',
        ...full,
      },
    ],
  })
})

// ---------------------------------------------------------------------------
// POST /scenario — project a chosen subset of action ids (auth)
// ---------------------------------------------------------------------------
const scenarioSchema = z.object({
  action_ids: z.array(z.string().min(1)).min(1),
})

router.post('/scenario', authMiddleware, zValidator('json', scenarioSchema), async (c) => {
  const userId = getUserId(c)
  const { action_ids } = c.req.valid('json')

  // Ownership check: only project actions belonging to the caller.
  const rows = (await db
    .select()
    .from(recovery_actions)
    .where(
      and(eq(recovery_actions.user_id, userId), inArray(recovery_actions.id, action_ids)),
    )) as ActionRow[]

  const monthly = rows.reduce((s, r) => s + (r.monthly_savings ?? 0), 0)
  const annual = rows.reduce((s, r) => s + (r.annual_savings ?? (r.monthly_savings ?? 0) * 12), 0)

  return c.json({
    monthly,
    annual,
    count: rows.length,
    matched_ids: rows.map((r) => r.id),
    missing_ids: action_ids.filter((id) => !rows.some((r) => r.id === id)),
  })
})

export default router
