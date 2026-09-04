import { ChatOpenAI } from '@langchain/openai'
import { env } from '../env.js'
import { LLM_PROVIDERS, PROVIDER_DEFAULTS } from './constants.js'
import type { LlmProvider } from './constants.js'

export type { LlmProvider }

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
    .map((provider) => {
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

export function getProviderInfo() {
  const chain = getModelChain()
  const primary = chain[0]
  if (!primary) throw new Error('No LLM API key configured')
  return primary
}
