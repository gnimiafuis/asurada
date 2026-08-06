import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { query } from '../../lib/postgres.js'
import { getQueue } from '../../lib/queue.js'

type ScheduleRow = {
  id: string
  cron: string
  prompt: string
  enabled: boolean
  last_run: string | null
}

export function createScheduleTools() {
  const createSchedule = tool(
    async ({ cron, prompt }, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context available'

      const id = randomUUID()
      await query('INSERT INTO schedules (id, thread_id, cron, prompt) VALUES ($1, $2, $3, $4)', [
        id,
        threadId,
        cron,
        prompt,
      ])

      // Register BullMQ repeatable job
      const queue = getQueue()
      await queue.add(
        `schedule-${id}`,
        { scheduleId: id, threadId, prompt },
        { repeat: { pattern: cron } },
      )

      return `Schedule created (ID: ${id}). The agent will run the following task on cron "${cron}":\n"${prompt}"\n\nThis thread will receive the results automatically when the schedule fires.`
    },
    {
      name: 'create_schedule',
      description: `Create a scheduled task that runs automatically on a recurring cron schedule. Use this when the user asks to set up recurring tasks, reminders, daily digests, or automated runs.

Common cron patterns:
- "0 9 * * *" → daily at 9:00 AM
- "0 9 * * 1" → every Monday at 9:00 AM
- "0 */6 * * *" → every 6 hours
- "*/30 * * * *" → every 30 minutes
- "0 9 1 * *" → 1st of every month at 9:00 AM

Cron fields: minute hour day-of-month month day-of-week`,
      schema: z.object({
        cron: z.string().describe('Standard 5-field cron expression'),
        prompt: z.string().describe('The task the agent should execute when the schedule fires'),
      }),
    },
  )

  const listSchedules = tool(
    async (_input, config) => {
      const threadId = (config?.configurable as { thread_id?: string } | undefined)?.thread_id
      if (!threadId) return 'Error: no thread context'

      const result = await query<ScheduleRow>(
        'SELECT id, cron, prompt, enabled, last_run FROM schedules WHERE thread_id = $1 ORDER BY created_at',
        [threadId],
      )
      if (result.rows.length === 0) return 'No schedules found for this conversation.'

      return result.rows
        .map((r) => {
          const status = r.enabled ? '✓ active' : '✗ disabled'
          const lastRun = r.last_run ? new Date(r.last_run).toISOString() : 'never'
          return `- ${status} | cron="${r.cron}" | last_run=${lastRun} | id=${r.id}\n  "${r.prompt.slice(0, 100)}"`
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
      const result = await query<ScheduleRow>('SELECT id, cron FROM schedules WHERE id = $1', [
        scheduleId,
      ])
      if (result.rows.length === 0) return 'Schedule not found.'

      const cron = result.rows[0]?.cron
      await query('DELETE FROM schedules WHERE id = $1', [scheduleId])

      const queue = getQueue()
      await queue.removeRepeatable(`schedule-${scheduleId}`, { pattern: cron })

      return 'Schedule deleted successfully.'
    },
    {
      name: 'delete_schedule',
      description: 'Delete a scheduled task by its ID.',
      schema: z.object({
        scheduleId: z.string().uuid().describe('The schedule ID to delete'),
      }),
    },
  )

  return [createSchedule, listSchedules, deleteSchedule]
}
