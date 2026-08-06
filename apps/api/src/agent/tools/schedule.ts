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

      const type = cron ? 'recurring' : delaySeconds || runAt ? 'once' : null
      if (!type) {
        return 'Error: provide either cron (recurring), delaySeconds (one-time), or runAt (one-time).'
      }

      const id = randomUUID()
      const finalLabel = label || prompt.slice(0, 40)

      if (type === 'once') {
        // Compute absolute runAt from delaySeconds or use runAt directly
        let computedRunAt: string
        if (delaySeconds) {
          computedRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString()
        } else {
          computedRunAt = runAt as string
        }

        const delay = new Date(computedRunAt).getTime() - Date.now()
        if (delay <= 0) {
          return `Error: the target time is in the past. Current UTC is ${new Date().toISOString()}.`
        }
        if (delay > 90 * 24 * 60 * 60 * 1000) {
          return `Error: runAt is more than 90 days away — this seems like a year error. Current UTC is ${new Date().toISOString()}. Use delaySeconds instead.`
        }

        await query(
          'INSERT INTO schedules (id, thread_id, type, label, cron, run_at, prompt) VALUES ($1, $2, $3, $4, NULL, $5, $6)',
          [id, threadId, type, finalLabel, computedRunAt, prompt],
        )

        const queue = getQueue()
        await queue.add(`schedule-${id}`, { scheduleId: id }, { delay, jobId: `schedule-${id}` })

        return `One-time schedule "${finalLabel}" created (ID: ${id}). Will run at ${computedRunAt} (UTC).`
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
      description: `Create a scheduled task. Three input modes:

1. RECURRING — use "cron" for repeating tasks ("every day at 9am" → cron="0 9 * * *").
2. ONE-TIME (PREFERRED) — use "delaySeconds" for relative time. Simple integer, no date math needed.
   - "in 30 seconds" → delaySeconds=30
   - "in 5 minutes"  → delaySeconds=300
   - "in 2 hours"    → delaySeconds=7200
   - "in 3 days"     → delaySeconds=259200
3. ONE-TIME (FALLBACK) — use "runAt" for specific calendar dates ("on Dec 25th" → runAt="2026-12-25T00:00:00Z").
   Only use this when delaySeconds doesn't apply (e.g. exact calendar dates).

Provide EXACTLY ONE of: cron, delaySeconds, or runAt. Always include "prompt".`,
      schema: z.object({
        cron: z
          .string()
          .optional()
          .describe('Cron expression for RECURRING tasks, e.g. "0 9 * * *"'),
        delaySeconds: z
          .number()
          .optional()
          .describe('Seconds from now for ONE-TIME tasks (PREFERRED). "in 2 hours" → 7200'),
        runAt: z
          .string()
          .optional()
          .describe(
            'ISO 8601 UTC datetime for ONE-TIME (FALLBACK, for specific calendar dates only)',
          ),
        label: z.string().optional().describe('Short name, e.g. "Daily News" or "SpaceX Check"'),
        prompt: z.string().describe('The task the agent should execute'),
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
