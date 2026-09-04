import { z } from 'zod'

export const threadSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  scheduleCount: z.number().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const createThreadSchema = z.object({
  title: z.string().min(1).max(200).optional(),
})

export const updateThreadSchema = z.object({
  title: z.string().min(1).max(200),
})

export const messageRoleSchema = z.enum(['system', 'user', 'assistant'])

export const messageSchema = z.object({
  role: messageRoleSchema,
  content: z.string(),
  thinking: z.string().optional(),
})

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(10_000),
  deepResearch: z.boolean().optional(),
})

export type Thread = z.infer<typeof threadSchema>
export type Message = z.infer<typeof messageSchema>
