import { z } from 'zod'
import { LLM_PROVIDERS } from './agent/constants.js'

const MaxOutputTokensSchema = z.object({
  /** Agent loop cap (chat + scheduled runs) — headroom for thinking tokens */
  agent: z.number().int().positive(),
  /** Deep-research synthesis cap — long-form reports */
  deep_research: z.number().int().positive(),
})

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),

  /**
   * Process role — controls what this instance runs.
   * - "api":    HTTP server only (no BullMQ worker)
   * - "worker": BullMQ worker only (no HTTP server)
   * - "all":    Both (default — for local dev)
   *
   * Deploy API and Worker as separate containers using the SAME image,
   * just with different ROLE values.
   */
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('glm'),
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY is required'),
  LLM_MODEL: z.string().optional(),
  LLM_FALLBACK_PROVIDERS: z.string().optional(),

  /** Per-call-type output caps, one JSON knob. Malformed JSON / wrong shape = boot error. */
  MAX_OUTPUT_TOKENS: z
    .string()
    .default('{"agent":8192,"deep_research":16384}')
    .superRefine((s, ctx) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(s)
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'not valid JSON' })
        return
      }
      const check = MaxOutputTokensSchema.safeParse(parsed)
      if (!check.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `expected {"agent":N,"deep_research":N} — ${check.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        })
      }
    })
    .transform((s) => JSON.parse(s) as z.infer<typeof MaxOutputTokensSchema>),

  /** Input history trim target (tokens). Last 2 turns always kept verbatim. */
  CONTEXT_TOKEN_BUDGET: z.coerce.number().int().min(2000).default(24000),
  /** Old tool results longer than this get truncated when context is over budget */
  TOOL_RESULT_TRIM_CHARS: z.coerce.number().int().min(0).default(400),

  // Web search tools — all optional. Tools activate only if their key is set.
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
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
