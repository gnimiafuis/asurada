import { z } from 'zod'

export const scheduleSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  cron: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  lastRun: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

export const createScheduleSchema = z.object({
  cron: z.string().min(1).max(100),
  prompt: z.string().min(1).max(10_000),
})

export const updateScheduleSchema = z.object({
  cron: z.string().min(1).max(100).optional(),
  prompt: z.string().min(1).max(10_000).optional(),
  enabled: z.boolean().optional(),
})

export type Schedule = z.infer<typeof scheduleSchema>
export type CreateSchedule = z.infer<typeof createScheduleSchema>
export type UpdateSchedule = z.infer<typeof updateScheduleSchema>
