import { ChatOpenAI } from '@langchain/openai'
import { env } from '../env.js'

export const LLM_PROVIDERS = ['glm', 'minimax', 'mimo', 'custom'] as const
export type LlmProvider = (typeof LLM_PROVIDERS)[number]

/**
 * All supported providers expose an OpenAI-compatible /chat/completions API.
 * Defaults reflect their hosted endpoint + a sensible model; override any
 * field via env (LLM_BASE_URL, LLM_MODEL).
 */
const PROVIDER_DEFAULTS: Record<LlmProvider, { baseURL: string; model: string; label: string }> = {
  glm: {
    // International (Z.ai). China alternative: https://open.bigmodel.cn/api/paas/v4
    baseURL: 'https://api.z.ai/api/paas/v4',
    model: 'glm-5.2',
    label: 'Zhipu GLM (Z.ai international)',
  },
  minimax: {
    // International (.io). China alternative: https://api.minimax.chat/v1
    baseURL: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3',
    label: 'MiniMax (international)',
  },
  mimo: {
    // Xiaomi MiMo via Singapore region (token-plan endpoint).
    // Available chat models: mimo-v2.5, mimo-v2.5-pro
    baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    label: 'Xiaomi MiMo (Singapore)',
  },
  custom: {
    // Any OpenAI-compatible endpoint (OpenRouter, Together, vLLM, Ollama, etc.)
    baseURL: 'http://localhost:11434/v1',
    model: 'gpt-4o-mini',
    label: 'Custom OpenAI-compatible',
  },
}

export function getProviderInfo(): {
  provider: LlmProvider
  baseURL: string
  model: string
  label: string
} {
  const provider = env.LLM_PROVIDER
  const def = PROVIDER_DEFAULTS[provider]
  return {
    provider,
    baseURL: env.LLM_BASE_URL ?? def.baseURL,
    model: env.LLM_MODEL ?? def.model,
    label: def.label,
  }
}

export function createLlm() {
  const { baseURL, model } = getProviderInfo()
  return new ChatOpenAI({
    apiKey: env.LLM_API_KEY,
    model,
    temperature: 0.7,
    maxTokens: 4096,
    streaming: true,
    configuration: { baseURL },
  })
}
