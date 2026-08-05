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
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    label: 'Zhipu GLM (智谱)',
  },
  minimax: {
    baseURL: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-Text-01',
    label: 'MiniMax',
  },
  mimo: {
    // Xiaomi MiMo — host via SiliconFlow, vLLM, or any OpenAI-compatible relay.
    // Set LLM_BASE_URL explicitly when using this provider.
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'XiaomiMiMo/MiMo-7B-RL',
    label: 'Xiaomi MiMo (小米)',
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
    streaming: true,
    configuration: { baseURL },
  })
}
