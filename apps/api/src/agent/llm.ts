import { ChatOpenAI } from '@langchain/openai'
import { env } from '../env.js'

export const LLM_PROVIDERS = ['glm', 'minimax', 'mimo', 'custom'] as const
export type LlmProvider = (typeof LLM_PROVIDERS)[number]

const PROVIDER_DEFAULTS: Record<LlmProvider, { baseURL: string; model: string; label: string }> = {
  glm: {
    baseURL: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.2',
    label: 'Zhipu GLM (Z.ai international)',
  },
  minimax: {
    baseURL: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    label: 'MiniMax (international)',
  },
  mimo: {
    baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    label: 'Xiaomi MiMo (Singapore)',
  },
  custom: {
    baseURL: 'http://localhost:11434/v1',
    model: 'gpt-4o-mini',
    label: 'Custom OpenAI-compatible',
  },
}

export type ModelConfig = {
  provider: LlmProvider
  baseURL: string
  model: string
  apiKey: string
  label: string
}

/** Resolve the API key for a provider: per-provider key, or fall back to generic LLM_API_KEY. */
function getApiKeyForProvider(provider: LlmProvider): string | undefined {
  const specific = process.env[`LLM_API_KEY_${provider.toUpperCase()}`]
  if (specific) return specific
  return env.LLM_API_KEY
}

/**
 * Build the model chain: primary first, then fallbacks.
 * Only includes providers that have an API key available.
 */
export function getModelChain(): ModelConfig[] {
  const primary = env.LLM_PROVIDER
  const fallbacks: LlmProvider[] = env.LLM_FALLBACK_PROVIDERS
    ? env.LLM_FALLBACK_PROVIDERS.split(',')
        .map((s) => s.trim() as LlmProvider)
        .filter((p) => LLM_PROVIDERS.includes(p))
    : []

  const chain = [primary, ...fallbacks]

  return chain
    .map((provider, _idx) => {
      const def = PROVIDER_DEFAULTS[provider]
      const apiKey = getApiKeyForProvider(provider)
      if (!apiKey) return null

      const isPrimary = provider === primary
      return {
        provider,
        baseURL: isPrimary ? (env.LLM_BASE_URL ?? def.baseURL) : def.baseURL,
        model: isPrimary ? (env.LLM_MODEL ?? def.model) : def.model,
        apiKey,
        label: def.label,
      }
    })
    .filter((m): m is ModelConfig => m !== null)
}

/** Create a single LLM instance (for backwards compat / non-agent use). */
export function createLlm(): ChatOpenAI {
  const chain = getModelChain()
  const primary = chain[0]
  if (!primary) throw new Error('No LLM API key configured')

  return new ChatOpenAI({
    apiKey: primary.apiKey,
    model: primary.model,
    temperature: 0.7,
    streaming: true,
    configuration: { baseURL: primary.baseURL },
  })
}

export function getProviderInfo() {
  const chain = getModelChain()
  const primary = chain[0]
  if (!primary) throw new Error('No LLM API key configured')
  return primary
}
