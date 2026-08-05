import { z } from 'zod'
import { LLM_PROVIDERS } from './agent/llm.js'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('glm'),
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_MODEL: z.string().optional(),
  AGENT_SYSTEM_PROMPT: z.string().default('You are a helpful assistant.'),
})

export type Env = z.infer<typeof EnvSchema>

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:')
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
    }
    throw new Error('Invalid environment configuration')
  }
  return parsed.data
}

export const env = loadEnv()
