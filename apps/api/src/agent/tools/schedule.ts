import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { query } from '../../lib/postgres.js'
import { getQueue } from '../../lib/queue.js'

type ScheduleRow = {
  id: string
  type: string
  cron: string | null
  run_at: string | null
  prompt: string
  enabled: boolean
  last_run: string | null
}

export function createScheduleTools() {
  // ─── ONE-TIME: fires once after N seconds ───
  const delayTask = tool(
    async ({ seconds, label, prompt }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context'

      const id = randomUUID()
      const finalLabel = label || prompt.slice(0, 40)
      const runAt = new Date(Date.now() + seconds * 1000).toISOString()

      await query(
        'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, NULL, $5, $6)',
        [id, threadId, 'once', finalLabel, runAt, prompt],
      )

      const queue = getQueue()
      await queue.add(
        `schedule-${id}`,
        { scheduleId: id },
        {
          delay: seconds * 1000,
          jobId: `schedule-${id}`,
        },
      )

      return `Done. "${finalLabel}" will run once in ${seconds}s (${runAt} UTC). ID: ${id}`
    },
    {
      name: 'delay_task',
      description: `Run a task ONCE after a delay. Convert time to seconds:
  30 sec=30 | 1 min=60 | 5 min=300 | 30 min=1800 | 1 hr=3600 | 2 hr=7200 | 6 hr=21600 | 1 day=86400 | 3 days=259200

Use when user says: "in X", "after X", "once", "remind me", "later", "at Xpm".`,
      schema: z.object({
        seconds: z
          .number()
          .min(1)
          .max(7776000)
          .describe('Delay in seconds. 1min=60, 1hr=3600, 1day=86400'),
        prompt: z.string().describe('What the agent should do'),
        label: z.string().optional().describe('Short name'),
      }),
    },
  )

  // ─── RECURRING: repeats every N seconds ───
  const repeatTask = tool(
    async ({ everySeconds, label, prompt }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context'

      const id = randomUUID()
      const finalLabel = label || prompt.slice(0, 40)

      // Store interval in cron column as "every:N" for later unregistration
      const cronValue = `every:${everySeconds}`

      await query(
        'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, $5, NULL, $6)',
        [id, threadId, 'recurring', finalLabel, cronValue, prompt],
      )

      const queue = getQueue()
      await queue.add(
        `schedule-${id}`,
        { scheduleId: id },
        {
          repeat: { every: everySeconds * 1000 },
        },
      )

      return `Done. "${finalLabel}" will run every ${everySeconds}s. ID: ${id}`
    },
    {
      name: 'repeat_task',
      description: `Run a task REPEATEDLY at a fixed interval. Convert interval to seconds:
  every 30 min=1800 | hourly=3600 | every 6 hr=21600 | daily=86400 | weekly=604800

Use ONLY when user says: "every", "daily", "weekly", "hourly", "recurring".`,
      schema: z.object({
        everySeconds: z
          .number()
          .min(60)
          .max(2592000)
          .describe('Interval in seconds. hourly=3600, daily=86400, weekly=604800'),
        prompt: z.string().describe('What the agent should do each time'),
        label: z.string().optional().describe('Short name'),
      }),
    },
  )

  // ─── LIST ───
  const listSchedules = tool(
    async (_input, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context'

      const result = await query<ScheduleRow>(
        'SELECT id, type, cron, run_at, prompt, enabled, last_run FROM schedules WHERE thread_id = $1 ORDER BY created_at',
        [threadId],
      )
      if (result.rows.length === 0) return 'No schedules.'

      return result.rows
        .map((r) => {
          const sched = r.type === 'once' ? `at ${r.run_at}` : `every ${r.cron}`
          return `- [${r.type}] ${r.enabled ? 'active' : 'off'} | ${sched} | ${r.id}\n  "${r.prompt.slice(0, 80)}"`
        })
        .join('\n')
    },
    {
      name: 'list_schedules',
      description: 'List all scheduled tasks.',
      schema: z.object({}),
    },
  )

  // ─── DELETE ───
  const deleteSchedule = tool(
    async ({ scheduleId }) => {
      const result = await query<ScheduleRow>(
        'SELECT id, type, cron FROM schedules WHERE id = $1',
        [scheduleId],
      )
      if (result.rows.length === 0) return 'Not found.'

      const row = result.rows[0]
      if (!row) return 'Not found.'

      await query('DELETE FROM schedules WHERE id = $1', [scheduleId])

      const queue = getQueue()
      if (row.type === 'recurring' && row.cron?.startsWith('every:')) {
        const ms = Number(row.cron.split(':')[1]) * 1000
        await queue.removeRepeatable(`schedule-${scheduleId}`, { every: ms })
      } else {
        await queue.remove(`schedule-${scheduleId}`)
      }

      return 'Cancelled.'
    },
    {
      name: 'delete_schedule',
      description: 'Cancel a scheduled task by ID.',
      schema: z.object({
        scheduleId: z.string().uuid().describe('Schedule ID to cancel'),
      }),
    },
  )

  return [delayTask, repeatTask, listSchedules, deleteSchedule]
}
