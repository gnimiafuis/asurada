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
    async ({ cron, runAt, delaySeconds, label, prompt }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context available'

      // Prefer one-time (delaySeconds/runAt) over recurring (cron) if both provided
      const type = delaySeconds || runAt ? 'once' : cron ? 'recurring' : null
      if (!type) {
        return 'Error: provide delaySeconds (one-time), cron (recurring), or runAt (calendar date).'
      }

      const id = randomUUID()
      const finalLabel = label || prompt.slice(0, 40)

      if (type === 'once') {
        let computedRunAt: string
        if (delaySeconds) {
          computedRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
        } else {
          computedRunAt = runAt as string
        }

        const delay = new Date(computedRunAt).getTime() - Date.now()
        if (delay <= 0) {
          return `Error: target time is in the past. Current UTC: ${new Date().toISOString()}.`
        }
        if (delay > 90 * 24 * 60 * 60 * 1000) {
          return 'Error: target is more than 90 days away. Use delaySeconds instead.'
        }

        await query(
          'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, NULL, $5, $6)',
          [id, threadId, type, finalLabel, computedRunAt, prompt],
        )

        const queue = getQueue()
        await queue.add(`schedule-${id}`, { scheduleId: id }, { delay, jobId: `schedule-${id}` })

        return `One-time schedule "${finalLabel}" created (ID: ${id}). Fires once at ${computedRunAt} (UTC), in ${Math.round(delay / 1000)}s.`
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
      description: `Schedule a task to run automatically. DEFAULT mode is one-time (fires once).

ONE-TIME (DEFAULT — use delaySeconds):
  Use when user says: "in X", "after X", "once", "remind me in X", "in a bit".
  Convert to seconds — simple integer, no date math:
    "in 30 seconds"=30 | "in 1 minute"=60 | "in 5 minutes"=300 | "in 2 hours"=7200 | "in 3 days"=259200

RECURRING (use cron — ONLY for explicit repeating tasks):
  Use when user says: "every", "daily", "weekly", "hourly", "recurring", "each day".
    "every day 9am"="0 9 * * *" | "every Monday"="0 9 * * 1" | "every 30 min"="*/30 * * * *"

CALENDAR DATE (use runAt — rare):
  Only for specific dates like "on Dec 25th". ISO 8601 UTC.

Always include "prompt". Optionally include "label".`,
      schema: z.object({
        delaySeconds: z
          .number()
          .optional()
          .describe('Seconds from now (ONE-TIME, DEFAULT). "in 1 min"=60, "in 2h"=7200'),
        cron: z
          .string()
          .optional()
          .describe('Cron (RECURRING only). ONLY if user says every/daily/weekly'),
        runAt: z.string().optional().describe('ISO UTC datetime (ONE-TIME, calendar date only)'),
        label: z.string().optional().describe('Short name, e.g. "News Update"'),
        prompt: z.string().describe('What the agent should do when it fires'),
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

      return 'Schedule cancelled successfully.'
    },
    {
      name: 'delete_schedule',
      description: 'Cancel/delete a scheduled task by its ID.',
      schema: z.object({
        scheduleId: z.string().uuid().describe('The schedule ID to cancel'),
      }),
    },
  )

  return [createSchedule, listSchedules, deleteSchedule]
}
