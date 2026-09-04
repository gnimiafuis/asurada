/**
 * Unified BullMQ schedule registration/removal — the single source of truth
 * for how schedules map to queue jobs. Both the REST routes and the agent's
 * schedule tools MUST use these (previously duplicated, subtly divergent
 * copies lived in routes/schedules.ts and agent/tools/schedule.ts).
 *
 * Three modes (mirroring the schedules table):
 *   once      (runAt ISO)      → delayed job, jobId = schedule-<id>
 *   every:N   (cron column)    → repeatable { every: N*1000 }
 *   cron+tz   (cron column)    → repeatable { pattern, tz }
 *
 * INVARIANT: unregister must pass the EXACT same repeat config used at add
 * time ({every: ms} vs {pattern, tz}) — BullMQ removeRepeatable silently
 * no-ops on a mismatch (the ghost-job bug class).
 */
import { getQueue } from './queue.js'

export type ScheduleJobSpec = {
  id: string
  type: string
  cron: string | null
  timezone: string | null
  runAt?: string | null
}

function jobName(id: string): string {
  return `schedule-${id}`
}

export async function registerScheduleJob(spec: ScheduleJobSpec): Promise<void> {
  const queue = getQueue()

  if (spec.type === 'once' && spec.runAt) {
    const delay = new Date(spec.runAt).getTime() - Date.now()
    if (delay > 0) {
      await queue.add(jobName(spec.id), { scheduleId: spec.id }, { delay, jobId: jobName(spec.id) })
    }
  } else if (spec.cron?.startsWith('every:')) {
    const ms = Number(spec.cron.split(':')[1]) * 1000
    await queue.add(jobName(spec.id), { scheduleId: spec.id }, { repeat: { every: ms } })
  } else if (spec.cron) {
    await queue.add(
      jobName(spec.id),
      { scheduleId: spec.id },
      { repeat: { pattern: spec.cron, tz: spec.timezone ?? undefined } },
    )
  }
}

export async function unregisterScheduleJob(
  spec: Pick<ScheduleJobSpec, 'id' | 'type' | 'cron' | 'timezone'>,
): Promise<void> {
  const queue = getQueue()

  if (spec.type === 'recurring' && spec.cron) {
    if (spec.cron.startsWith('every:')) {
      const ms = Number(spec.cron.split(':')[1]) * 1000
      await queue.removeRepeatable(jobName(spec.id), { every: ms })
    } else {
      await queue.removeRepeatable(jobName(spec.id), {
        pattern: spec.cron,
        tz: spec.timezone ?? undefined,
      })
    }
  } else {
    await queue.remove(jobName(spec.id))
  }
}
