import { z } from 'zod'

export const scheduleSchema = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  label: z.string().nullable(),
  type: z.enum(['recurring', 'once']),
  cron: z.string().nullable(),
  timezone: z.string().nullable(),
  runAt: z.string().datetime().nullable(),
  prompt: z.string(),
  enabled: z.boolean(),
  lastRun: z.string().datetime().nullable(),
  nextRun: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

export const createScheduleSchema = z.object({
  cron: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).max(60).optional(),
  runAt: z.string().datetime().optional(),
  delaySeconds: z.number().int().min(1).max(7776000).optional(),
  label: z.string().min(1).max(100).optional(),
  prompt: z.string().min(1).max(10_000),
})

export const updateScheduleSchema = z.object({
  cron: z.string().min(1).max(100).optional(),
  prompt: z.string().min(1).max(10_000).optional(),
  label: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
})

export type Schedule = z.infer<typeof scheduleSchema>
