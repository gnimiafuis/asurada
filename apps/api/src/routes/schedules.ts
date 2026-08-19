import { randomUUID } from 'node:crypto'
import { createScheduleSchema, updateScheduleSchema } from '@asurada/shared'
import { CronExpressionParser } from 'cron-parser'
import { Hono } from 'hono'
import { z } from 'zod'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { query } from '../lib/postgres.js'
import { getQueue } from '../lib/queue.js'

type ScheduleRow = {
  id: string
  thread_id: string
  type: string
  label: string | null
  cron: string | null
  timezone: string | null
  run_at: string | null
  prompt: string
  enabled: boolean
  last_run: string | null
  created_at: string
}

const threadParams = z.object({ id: z.string().uuid() })
const scheduleParams = z.object({ id: z.string().uuid() })

function getNextRun(row: ScheduleRow): string | null {
  if (!row.enabled) return null
  if (row.type === 'once' && row.run_at) return new Date(row.run_at).toISOString()
  if (row.cron?.startsWith('every:')) {
    const seconds = Number(row.cron.split(':')[1])
    const lastMs = row.last_run ? new Date(row.last_run).getTime() : Date.now()
    return new Date(lastMs + seconds * 1000).toISOString()
  }
  if (row.cron) {
    try {
      return CronExpressionParser.parse(row.cron, {
        tz: row.timezone ?? undefined,
      })
        .next()
        .toISOString()
    } catch {
      return null
    }
  }
  return null
}

function mapRow(row: ScheduleRow) {
  return {
    id: row.id,
    threadId: row.thread_id,
    label: row.label,
    type: row.type as 'recurring' | 'once',
    cron: row.cron,
    timezone: row.timezone,
    runAt: row.run_at ? new Date(row.run_at).toISOString() : null,
    prompt: row.prompt,
    enabled: row.enabled,
    lastRun: row.last_run ? new Date(row.last_run).toISOString() : null,
    nextRun: getNextRun(row),
    createdAt: new Date(row.created_at).toISOString(),
  }
}

async function requireThread(threadId: string) {
  const result = await query('SELECT id FROM threads WHERE id = $1', [threadId])
  if (result.rows.length === 0) throw new NotFoundError('Thread')
}

async function requireSchedule(scheduleId: string): Promise<ScheduleRow> {
  const result = await query<ScheduleRow>(
    'SELECT id, thread_id, type, label, cron, timezone, run_at, prompt, enabled, last_run, created_at FROM schedules WHERE id = $1',
    [scheduleId],
  )
  const row = result.rows[0]
  if (!row) throw new NotFoundError('Schedule')
  return row
}

/** Register a BullMQ job — repeatable for recurring (interval or cron+tz), delayed for one-time. */
async function registerJob(schedule: {
  id: string
  type: string
  cron: string | null
  timezone: string | null
  runAt: string | null
}) {
  const queue = getQueue()
  if (schedule.type === 'once' && schedule.runAt) {
    const delay = new Date(schedule.runAt).getTime() - Date.now()
    if (delay > 0) {
      await queue.add(
        `schedule-${schedule.id}`,
        { scheduleId: schedule.id },
        { delay, jobId: `schedule-${schedule.id}` },
      )
    }
  } else if (schedule.cron?.startsWith('every:')) {
    const ms = Number(schedule.cron.split(':')[1]) * 1000
    await queue.add(
      `schedule-${schedule.id}`,
      { scheduleId: schedule.id },
      { repeat: { every: ms } },
    )
  } else if (schedule.cron) {
    await queue.add(
      `schedule-${schedule.id}`,
      { scheduleId: schedule.id },
      { repeat: { pattern: schedule.cron, tz: schedule.timezone ?? undefined } },
    )
  }
}

/** Unregister a BullMQ job — must match the exact config used at add time
 *  ({every: ms} vs {pattern, tz}), otherwise BullMQ silently no-ops. */
async function unregisterJob(
  scheduleId: string,
  type: string,
  cron: string | null,
  timezone: string | null,
) {
  const queue = getQueue()
  if (type === 'recurring' && cron) {
    if (cron.startsWith('every:')) {
      const ms = Number(cron.split(':')[1]) * 1000
      await queue.removeRepeatable(`schedule-${scheduleId}`, { every: ms })
    } else {
      await queue.removeRepeatable(`schedule-${scheduleId}`, {
        pattern: cron,
        tz: timezone ?? undefined,
      })
    }
  } else {
    await queue.remove(`schedule-${scheduleId}`)
  }
}

export const schedules = new Hono()

// List schedules for a thread
schedules.get('/threads/:id/schedules', async (c) => {
  const parsed = threadParams.safeParse(c.req.param())
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())
  await requireThread(parsed.data.id)

  const result = await query<ScheduleRow>(
    'SELECT id, thread_id, type, label, cron, timezone, run_at, prompt, enabled, last_run, created_at FROM schedules WHERE thread_id = $1 ORDER BY created_at DESC',
    [parsed.data.id],
  )
  return c.json(result.rows.map(mapRow))
})

// Create schedule
schedules.post('/threads/:id/schedules', async (c) => {
  const paramsParsed = threadParams.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  await requireThread(paramsParsed.data.id)

  const json = await c.req.json().catch(() => null)
  const parsed = createScheduleSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const { cron, runAt, delaySeconds, label, prompt, timezone } = parsed.data
  const type = cron ? 'recurring' : delaySeconds || runAt ? 'once' : null
  if (!type)
    throw new ValidationError({
      formErrors: ['Provide cron, delaySeconds, or runAt'],
      fieldErrors: {},
    })

  // Compute runAt from delaySeconds if provided (preferred over raw runAt)
  const finalRunAt = delaySeconds
    ? new Date(Date.now() + delaySeconds * 1000).toISOString()
    : (runAt ?? null)

  // Validate one-time schedules aren't implausibly far out
  if (type === 'once' && finalRunAt) {
    const delay = new Date(finalRunAt).getTime() - Date.now()
    if (delay <= 0)
      throw new ValidationError({
        formErrors: ['Target time must be in the future'],
        fieldErrors: {},
      })
    if (delay > 90 * 24 * 60 * 60 * 1000)
      throw new ValidationError({
        formErrors: ['Target time is more than 90 days away'],
        fieldErrors: {},
      })
  }

  const id = randomUUID()
  const finalLabel = label || prompt.slice(0, 40)
  const finalTimezone = timezone ?? null
  const result = await query<ScheduleRow>(
    `INSERT INTO schedules (id, thread_id, type, label, cron, timezone, run_at, prompt)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, thread_id, type, label, cron, timezone, run_at, prompt, enabled, last_run, created_at`,
    [id, paramsParsed.data.id, type, finalLabel, cron ?? null, finalTimezone, finalRunAt, prompt],
  )
  const created = result.rows[0]
  if (!created) throw new Error('INSERT did not return a row')

  await registerJob({
    id: created.id,
    type: created.type,
    cron: created.cron,
    timezone: created.timezone,
    runAt: created.run_at,
  })

  return c.json(mapRow(created), 201)
})

// Update schedule
schedules.patch('/schedules/:id', async (c) => {
  const paramsParsed = scheduleParams.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  const existing = await requireSchedule(paramsParsed.data.id)

  const json = await c.req.json().catch(() => null)
  const parsed = updateScheduleSchema.safeParse(json ?? {})
  if (!parsed.success) throw new ValidationError(parsed.error.flatten())

  const cron = parsed.data.cron ?? existing.cron
  const label = parsed.data.label ?? existing.label
  const prompt = parsed.data.prompt ?? existing.prompt
  const enabled = parsed.data.enabled ?? existing.enabled

  const result = await query<ScheduleRow>(
    `UPDATE schedules SET cron = $1, label = $2, prompt = $3, enabled = $4
     WHERE id = $5
     RETURNING id, thread_id, type, label, cron, run_at, prompt, enabled, last_run, created_at`,
    [cron, label, prompt, enabled, paramsParsed.data.id],
  )
  const updated = result.rows[0]
  if (!updated) throw new NotFoundError('Schedule')

  // Re-register if cron changed
  if (parsed.data.cron) {
    await unregisterJob(existing.id, existing.type, existing.cron, existing.timezone)
    if (enabled)
      await registerJob({
        id: updated.id,
        type: updated.type,
        cron: updated.cron,
        timezone: updated.timezone,
        runAt: updated.run_at,
      })
  }

  return c.json(mapRow(updated))
})

// Delete schedule
schedules.delete('/schedules/:id', async (c) => {
  const paramsParsed = scheduleParams.safeParse(c.req.param())
  if (!paramsParsed.success) throw new ValidationError(paramsParsed.error.flatten())
  const existing = await requireSchedule(paramsParsed.data.id)

  await query('DELETE FROM schedules WHERE id = $1', [paramsParsed.data.id])
  await unregisterJob(existing.id, existing.type, existing.cron, existing.timezone)

  return c.body(null, 204)
})
