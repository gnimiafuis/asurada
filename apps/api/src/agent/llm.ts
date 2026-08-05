import { ChatAnthropic } from '@langchain/anthropic'
import { env } from '../env.js'

export function createLlm() {
  return new ChatAnthropic({
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    model: env.AGENT_MODEL,
    temperature: 0.7,
    streaming: true,
  })
}
