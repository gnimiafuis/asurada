import { createUserSchema, updateUserSchema, type userSchema } from '@asurada/shared'
import { Hono } from 'hono'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { query } from '../lib/postgres.js'

type Row = { id: string; email: string; name: string; created_at: string; updated_at: string }

const paramsSchema = z.object({ id: z.string().uuid() })

function mapRow(row: Row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function requireUser(id: string) {
  const result = await query<Row>(
    'SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1',
    [id],
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('User')
  return mapRow(row)
}

export const users = new Hono()

users.get('/users', async (c) => {
  const result = await query<Row>(
    'SELECT id, email, name, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 100',
  )
  return c.json(result.rows.map(mapRow))
})

users.get('/users/:id', async (c) => {
  const parsed = paramsSchema.safeParse(c.req.param())
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  const user = await requireUser(parsed.data.id)
  return c.json(user)
})

users.post('/users', async (c) => {
  const json = await c.req.json().catch(() => null)
  const parsed = createUserSchema.safeParse(json)
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  const result = await query<Row>(
    'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name, created_at, updated_at',
    [parsed.data.email, parsed.data.name],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT did not return a row')
  return c.json(mapRow(row), 201)
})

users.patch('/users/:id', async (c) => {
  const paramsParsed = paramsSchema.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())

  const json = await c.req.json().catch(() => null)
  const parsed = updateUserSchema.safeParse(json)
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const sets: string[] = []
  const values: unknown[] = []
  if (parsed.data.email) {
    values.push(parsed.data.email)
    sets.push(`email = $${values.length}`)
  }
  if (parsed.data.name) {
    values.push(parsed.data.name)
    sets.push(`name = $${values.length}`)
  }

  if (sets.length === 0) {
    const user = await requireUser(paramsParsed.data.id)
    return c.json(user)
  }

  values.push(paramsParsed.data.id)
  const result = await query<Row>(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING id, email, name, created_at, updated_at`,
    values,
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('User')
  return c.json(mapRow(row))
})

users.delete('/users/:id', async (c) => {
  const parsed = paramsSchema.safeParse(c.req.param())
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [parsed.data.id])
  if (result.rows.length === 0) throw new NotFoundError('User')
  return c.body(null, 204)
})

export type UserResponse = z.infer<typeof userSchema>
