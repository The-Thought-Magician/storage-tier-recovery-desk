import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { pricing_books, pricing_entries } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const bookSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive().optional(),
  is_default: z.boolean().optional(),
  currency: z.string().min(1).optional(),
})

const entrySchema = z.object({
  book_id: z.string().min(1),
  provider: z.string().min(1),
  region: z.string().min(1),
  tier: z.string().min(1),
  storage_per_gb_month: z.number().nonnegative(),
  retrieval_per_gb: z.number().nonnegative().optional(),
  request_per_1k: z.number().nonnegative().optional(),
  min_duration_days: z.number().int().nonnegative().optional(),
  early_delete_penalty_per_gb: z.number().nonnegative().optional(),
})

const entryUpdateSchema = entrySchema.partial().omit({ book_id: true })

// ---------------------------------------------------------------------------
// GET /books — public — list pricing books
// ---------------------------------------------------------------------------
router.get('/books', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(pricing_books)
        .where(eq(pricing_books.user_id, userId))
        .orderBy(desc(pricing_books.is_default), desc(pricing_books.created_at))
    : await db.select().from(pricing_books).orderBy(desc(pricing_books.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /books/:id/entries — public — list entries for a book
// ---------------------------------------------------------------------------
router.get('/books/:id/entries', async (c) => {
  const bookId = c.req.param('id')
  const [book] = await db.select().from(pricing_books).where(eq(pricing_books.id, bookId))
  if (!book) return c.json({ error: 'Not found' }, 404)
  const entries = await db
    .select()
    .from(pricing_entries)
    .where(eq(pricing_entries.book_id, bookId))
    .orderBy(pricing_entries.provider, pricing_entries.region, pricing_entries.tier)
  return c.json(entries)
})

// ---------------------------------------------------------------------------
// POST /books — auth — create pricing book (versioned for reproducibility)
// ---------------------------------------------------------------------------
router.post('/books', authMiddleware, zValidator('json', bookSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Version: caller-provided, else next version of an existing book with the
  // same name, else 1. Keeps savings reproducible against a pinned version.
  let version = body.version
  if (version === undefined) {
    const sameName = await db
      .select()
      .from(pricing_books)
      .where(and(eq(pricing_books.user_id, userId), eq(pricing_books.name, body.name)))
      .orderBy(desc(pricing_books.version))
    version = sameName.length > 0 ? (sameName[0].version ?? 0) + 1 : 1
  }

  // Enforce single default per user.
  if (body.is_default) {
    await db
      .update(pricing_books)
      .set({ is_default: false })
      .where(eq(pricing_books.user_id, userId))
  }

  const [book] = await db
    .insert(pricing_books)
    .values({
      user_id: userId,
      name: body.name,
      version,
      is_default: body.is_default ?? false,
      currency: body.currency ?? 'USD',
    })
    .returning()
  return c.json(book, 201)
})

// ---------------------------------------------------------------------------
// POST /entries — auth — create pricing entry
// ---------------------------------------------------------------------------
router.post('/entries', authMiddleware, zValidator('json', entrySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ownership: the parent book must belong to the caller.
  const [book] = await db.select().from(pricing_books).where(eq(pricing_books.id, body.book_id))
  if (!book) return c.json({ error: 'Book not found' }, 404)
  if (book.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const [entry] = await db
    .insert(pricing_entries)
    .values({
      user_id: userId,
      book_id: body.book_id,
      provider: body.provider,
      region: body.region,
      tier: body.tier,
      storage_per_gb_month: body.storage_per_gb_month,
      retrieval_per_gb: body.retrieval_per_gb ?? 0,
      request_per_1k: body.request_per_1k ?? 0,
      min_duration_days: body.min_duration_days ?? 0,
      early_delete_penalty_per_gb: body.early_delete_penalty_per_gb ?? 0,
    })
    .onConflictDoUpdate({
      target: [
        pricing_entries.book_id,
        pricing_entries.provider,
        pricing_entries.region,
        pricing_entries.tier,
      ],
      set: {
        storage_per_gb_month: body.storage_per_gb_month,
        retrieval_per_gb: body.retrieval_per_gb ?? 0,
        request_per_1k: body.request_per_1k ?? 0,
        min_duration_days: body.min_duration_days ?? 0,
        early_delete_penalty_per_gb: body.early_delete_penalty_per_gb ?? 0,
      },
    })
    .returning()
  return c.json(entry, 201)
})

// ---------------------------------------------------------------------------
// PUT /entries/:id — auth — update entry
// ---------------------------------------------------------------------------
router.put('/entries/:id', authMiddleware, zValidator('json', entryUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(pricing_entries).where(eq(pricing_entries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [updated] = await db
    .update(pricing_entries)
    .set(body)
    .where(eq(pricing_entries.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /entries/:id — auth — delete entry
// ---------------------------------------------------------------------------
router.delete('/entries/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(pricing_entries).where(eq(pricing_entries.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(pricing_entries).where(eq(pricing_entries.id, id))
  return c.json({ success: true })
})

export default router
