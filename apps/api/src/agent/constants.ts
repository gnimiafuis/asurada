export const LLM_PROVIDERS = ['glm', 'minimax', 'mimo', 'custom'] as const
export type LlmProvider = (typeof LLM_PROVIDERS)[number]

export const PROVIDER_DEFAULTS: Record<
  LlmProvider,
  { baseURL: string; model: string; label: string }
> = {
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
