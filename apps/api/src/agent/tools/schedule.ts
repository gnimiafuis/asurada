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
  // ─── ONE-TIME: fires once after delaySeconds ───
  const scheduleOnce = tool(
    async ({ delaySeconds, label, prompt }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context'

      const id = randomUUID()
      const finalLabel = label || prompt.slice(0, 40)
      const computedRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString()

      await query(
        'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, NULL, $5, $6)',
        [id, threadId, 'once', finalLabel, computedRunAt, prompt],
      )

      const queue = getQueue()
      await queue.add(
        `schedule-${id}`,
        { scheduleId: id },
        {
          delay: delaySeconds * 1000,
          jobId: `schedule-${id}`,
        },
      )

      return `Scheduled "${finalLabel}" to run once in ${delaySeconds}s (${computedRunAt} UTC). ID: ${id}`
    },
    {
      name: 'schedule_once',
      description: `Schedule a ONE-TIME task that fires once after a delay. Use for: "in X", "after X", "once", "remind me in X".

Convert the delay to seconds:
  30 seconds=30 | 1 minute=60 | 5 minutes=300 | 30 minutes=1800
  1 hour=3600 | 2 hours=7200 | 6 hours=21600 | 1 day=86400 | 3 days=259200`,
      schema: z.object({
        delaySeconds: z
          .number()
          .min(1)
          .max(7776000)
          .describe('Seconds from now until the task fires. 1min=60, 1hr=3600, 1day=86400'),
        prompt: z.string().describe('What the agent should do when it fires'),
        label: z.string().optional().describe('Short name, e.g. "News Update"'),
      }),
    },
  )

  // ─── RECURRING: repeats on a cron schedule ───
  const scheduleRecurring = tool(
    async ({ cron, label, prompt }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context'

      const id = randomUUID()
      const finalLabel = label || prompt.slice(0, 40)

      await query(
        'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, $5, NULL, $6)',
        [id, threadId, 'recurring', finalLabel, cron, prompt],
      )

      const queue = getQueue()
      await queue.add(`schedule-${id}`, { scheduleId: id }, { repeat: { pattern: cron } })

      return `Scheduled "${finalLabel}" to run on cron "${cron}". ID: ${id}`
    },
    {
      name: 'schedule_recurring',
      description: `Schedule a RECURRING task that repeats on a cron schedule. Use ONLY when user says "every", "daily", "weekly", "hourly", "recurring".

Common cron patterns:
  "0 9 * * *"=daily 9am | "0 9 * * 1"=every Monday | "0 */6 * * *"=every 6 hours | "*/30 * * * *"=every 30 min`,
      schema: z.object({
        cron: z
          .string()
          .describe('Standard 5-field cron expression, e.g. "0 9 * * *" for daily at 9am'),
        prompt: z.string().describe('What the agent should do each time it fires'),
        label: z.string().optional().describe('Short name, e.g. "Daily News"'),
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
      if (result.rows.length === 0) return 'No schedules found for this conversation.'

      return result.rows
        .map((r) => {
          const status = r.enabled ? 'active' : 'disabled'
          const lastRun = r.last_run ? new Date(r.last_run).toISOString() : 'never'
          const sched = r.type === 'once' ? `fires at ${r.run_at}` : `cron="${r.cron}"`
          return `- [${r.type}] ${status} | ${sched} | last_run=${lastRun} | id=${r.id}\n  "${r.prompt.slice(0, 100)}"`
        })
        .join('\n\n')
    },
    {
      name: 'list_schedules',
      description: 'List all scheduled tasks for the current conversation.',
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
      if (result.rows.length === 0) return 'Schedule not found.'

      const row = result.rows[0]
      if (!row) return 'Schedule not found.'

      await query('DELETE FROM schedules WHERE id = $1', [scheduleId])

      const queue = getQueue()
      if (row.type === 'recurring' && row.cron) {
        await queue.removeRepeatable(`schedule-${scheduleId}`, { pattern: row.cron })
      } else {
        await queue.remove(`schedule-${scheduleId}`)
      }

      return 'Schedule cancelled.'
    },
    {
      name: 'delete_schedule',
      description: 'Cancel/delete a scheduled task by its ID.',
      schema: z.object({
        scheduleId: z.string().uuid().describe('The schedule ID to cancel'),
      }),
    },
  )

  return [scheduleOnce, scheduleRecurring, listSchedules, deleteSchedule]
}
