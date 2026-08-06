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
  const createSchedule = tool(
    async ({ cron, runAt, label, prompt }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context available'

      const type = cron ? 'recurring' : runAt ? 'once' : null
      if (!type) {
        return 'Error: provide either cron (for recurring tasks) or runAt (for one-time tasks).'
      }

      const id = randomUUID()
      const finalLabel = label || prompt.slice(0, 40)

      if (type === 'once') {
        const delay = new Date(runAt as string).getTime() - Date.now()
        if (delay <= 0) {
          return `Error: runAt (${runAt}) is in the past. Current UTC time is ${new Date().toISOString()}. Please provide a future datetime.`
        }
        if (delay > 90 * 24 * 60 * 60 * 1000) {
          return `Error: runAt (${runAt}) is more than 90 days away — this seems like a year error. Current UTC time is ${new Date().toISOString()}. Please regenerate runAt using the current year.`
        }

        await query(
          'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, NULL, $5, $6)',
          [id, threadId, type, finalLabel, runAt, prompt],
        )

        const queue = getQueue()
        await queue.add(`schedule-${id}`, { scheduleId: id }, { delay, jobId: `schedule-${id}` })

        return `One-time schedule "${finalLabel}" created (ID: ${id}). Will run at ${runAt} (UTC).`
      }

      // Recurring
      await query(
        'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, $5, NULL, $6)',
        [id, threadId, type, finalLabel, cron, prompt],
      )

      const queue = getQueue()
      await queue.add(`schedule-${id}`, { scheduleId: id }, { repeat: { pattern: cron as string } })

      return `Recurring schedule "${finalLabel}" created (ID: ${id}). Runs on cron "${cron}".`
    },
    {
      name: 'create_schedule',
      description: `Create a scheduled task. Two modes:

1. RECURRING — use "cron" for tasks that repeat (daily, weekly, hourly).
   Common cron: "0 9 * * *" (daily 9am), "0 9 * * 1" (weekly Mon), "0 */6 * * *" (every 6h).
2. ONE-TIME — use "runAt" for tasks that fire once at a specific time.
   Format: ISO 8601 datetime in UTC, e.g. "2026-08-07T15:00:00Z".
   Use when user says "in 2 hours", "tomorrow at 3pm", "at 5pm".

Provide EITHER cron OR runAt (not both). Always include "prompt".`,
      schema: z.object({
        cron: z
          .string()
          .optional()
          .describe('Standard 5-field cron expression for RECURRING tasks'),
        runAt: z
          .string()
          .optional()
          .describe('ISO 8601 datetime (UTC) for ONE-TIME tasks, e.g. "2026-08-07T15:00:00Z"'),
        label: z
          .string()
          .optional()
          .describe('Short name for this schedule, e.g. "Daily News" or "SpaceX Check"'),
        prompt: z.string().describe('The task the agent should execute when the schedule fires'),
      }),
    },
  )

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
          const status = r.enabled ? '✓ active' : '✗ disabled'
          const lastRun = r.last_run ? new Date(r.last_run).toISOString() : 'never'
          const schedule = r.type === 'once' ? `run_at=${r.run_at}` : `cron="${r.cron}"`
          return `- ${status} | ${r.type} | ${schedule} | last_run=${lastRun} | id=${r.id}\n  "${r.prompt.slice(0, 100)}"`
        })
        .join('\n\n')
    },
    {
      name: 'list_schedules',
      description:
        'List all scheduled tasks (recurring and one-time) for the current conversation.',
      schema: z.object({}),
    },
  )

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

      return 'Schedule deleted successfully.'
    },
    {
      name: 'delete_schedule',
      description: 'Delete a scheduled task (recurring or one-time) by its ID.',
      schema: z.object({
        scheduleId: z.string().uuid().describe('The schedule ID to delete'),
      }),
    },
  )

  return [createSchedule, listSchedules, deleteSchedule]
}
