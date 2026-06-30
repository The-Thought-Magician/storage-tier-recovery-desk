import { Hono } from 'hono'
import { db } from '../db/index.js'
import { activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// Public: activity feed. Optional filter by entity_type, optional limit (default 100, max 500).
router.get('/', async (c) => {
  const entityType = c.req.query('entity_type')
  const limitRaw = c.req.query('limit')

  let limit = 100
  if (limitRaw !== undefined) {
    const parsed = parseInt(limitRaw, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, 500)
    }
  }

  const conds = []
  if (entityType && entityType.trim() !== '') {
    conds.push(eq(activity_log.entity_type, entityType))
  }

  const rows = conds.length
    ? await db
        .select()
        .from(activity_log)
        .where(and(...conds))
        .orderBy(desc(activity_log.created_at))
        .limit(limit)
    : await db
        .select()
        .from(activity_log)
        .orderBy(desc(activity_log.created_at))
        .limit(limit)

  return c.json(rows)
})

export default router
