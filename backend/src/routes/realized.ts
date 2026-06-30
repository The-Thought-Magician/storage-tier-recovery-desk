import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  realized_savings,
  recovery_actions,
  recovery_cycles,
  activity_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function logActivity(
  userId: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown>,
) {
  try {
    await db.insert(activity_log).values({
      user_id: userId,
      entity_type: 'realized_saving',
      entity_id: entityId,
      action,
      detail,
    })
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// GET / — realized savings records (query: cycle_id, account scoping via action)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const cycleId = c.req.query('cycle_id')
  const rows = cycleId
    ? await db
        .select()
        .from(realized_savings)
        .where(eq(realized_savings.cycle_id, cycleId))
        .orderBy(desc(realized_savings.realized_at))
    : await db
        .select()
        .from(realized_savings)
        .orderBy(desc(realized_savings.realized_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /summary — cumulative realized vs modeled, run-rate
// ---------------------------------------------------------------------------

router.get('/summary', async (c) => {
  const cycleId = c.req.query('cycle_id')
  const rows = cycleId
    ? await db.select().from(realized_savings).where(eq(realized_savings.cycle_id, cycleId))
    : await db.select().from(realized_savings)

  const realized_monthly = rows.reduce((s, r) => s + (r.realized_monthly ?? 0), 0)
  const modeled_monthly = rows.reduce((s, r) => s + (r.modeled_monthly ?? 0), 0)
  const variance = realized_monthly - modeled_monthly

  return c.json({
    realized_monthly: Math.round(realized_monthly * 100) / 100,
    modeled_monthly: Math.round(modeled_monthly * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    annualized: Math.round(realized_monthly * 12 * 100) / 100,
    count: rows.length,
    attainment_pct:
      modeled_monthly > 0
        ? Math.round((realized_monthly / modeled_monthly) * 1000) / 10
        : 0,
  })
})

// ---------------------------------------------------------------------------
// POST / — record realized savings for an action (mark the action done)
//
// realized_savings.action_id is UNIQUE: recording again upserts the same row.
// ---------------------------------------------------------------------------

const recordSchema = z.object({
  action_id: z.string().min(1),
  realized_monthly: z.number().optional(),
  modeled_monthly: z.number().optional(),
  realized_at: z.string().datetime().optional(),
})

router.post('/', authMiddleware, zValidator('json', recordSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [action] = await db
    .select()
    .from(recovery_actions)
    .where(eq(recovery_actions.id, body.action_id))
  if (!action) return c.json({ error: 'Action not found' }, 404)
  if (action.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const modeled = body.modeled_monthly ?? action.monthly_savings ?? 0
  const realized = body.realized_monthly ?? modeled
  const variance = realized - modeled
  const realizedAt = body.realized_at ? new Date(body.realized_at) : new Date()

  const [row] = await db
    .insert(realized_savings)
    .values({
      user_id: userId,
      action_id: action.id,
      cycle_id: action.cycle_id ?? null,
      modeled_monthly: modeled,
      realized_monthly: realized,
      variance,
      realized_at: realizedAt,
    })
    .onConflictDoUpdate({
      target: realized_savings.action_id,
      set: {
        modeled_monthly: modeled,
        realized_monthly: realized,
        variance,
        cycle_id: action.cycle_id ?? null,
        realized_at: realizedAt,
      },
    })
    .returning()

  // Recording realized savings marks the underlying action done.
  if (action.status !== 'done') {
    await db
      .update(recovery_actions)
      .set({ status: 'done', updated_at: new Date() })
      .where(eq(recovery_actions.id, action.id))
  }

  await logActivity(userId, row.id, 'record', {
    action_id: action.id,
    realized_monthly: realized,
    variance,
  })

  return c.json(row, 201)
})

export default router
