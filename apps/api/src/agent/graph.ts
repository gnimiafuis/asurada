import * as messages from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { toolsCondition } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import { logger } from '../lib/logger.js'
import { createDedupedToolNode } from './dedupTools.js'
import { getModelChain } from './llm.js'
import { buildTools } from './tools/index.js'

export { messages }

export const AGENT_SYSTEM_PROMPT = `You are a helpful AI assistant with web search and scheduling tools.

Rules:
- If you already have search results earlier in this conversation, USE THEM. Do not search again for the same topic.
- Only search when you genuinely lack information you don't already have.
- Pick ONE search tool per query. Only try a different one if the first returned an error or nothing useful.
- If a tool result starts with [DUPLICATE CALL], it is your own earlier result. Use it and respond immediately — do not call tools again.
- Call tools SILENTLY without narrating. Give your full response only AFTER seeing results.
- Be concise. Use markdown. Cite sources with URLs.
- To schedule a one-time task ("in 2 hours", "remind me tomorrow", "after 30 min"), use delay_task with the delay in seconds (1min=60, 1hr=3600, 1day=86400). No confirmation needed.
- For recurring tasks ("every 30 min", "daily", "weekly"), use repeat_task. For clock-time schedules ("daily at 10am HK"), use repeat_task with cron ("0 10 * * *") + timezone ("Asia/Hong_Kong"); otherwise use everySeconds. It ALWAYS requires confirmation: first call returns a confirmation request → ask the user → on explicit yes, call repeat_task again with confirmed=true → on no, use delay_task instead.
- Examples: "in 2 hours" → delay_task(seconds=7200) | "news every 30 min" → repeat_task(everySeconds=1800) | "weather daily at 10am HK" → repeat_task(cron="0 10 * * *", timezone="Asia/Hong_Kong")
- Use list_schedules to show active schedules, delete_schedule to cancel one.`

export function buildSystemPrompt(): string {
  const DATE_TIME_SYSTEM_PROMPT = `Current date and time (UTC): ${new Date().toISOString()}`
  return `${AGENT_SYSTEM_PROMPT}\n\n${DATE_TIME_SYSTEM_PROMPT}`
}

/**
 * Build a tool-calling LangGraph agent with model fallback and checkpointing.
 *
 * The graph loops: agent → (wants tools?) → tools → agent → ... → (no tools?) → END
 * If the primary model fails, it tries fallback models in order.
 */
export function buildAgent(
  checkpointer: PostgresSaver,
  env: { TAVILY_API_KEY?: string; EXA_API_KEY?: string; FIRECRAWL_API_KEY?: string },
) {
  const tools = buildTools(env)
  const modelChain = getModelChain()

  // Pre-build all models with tools bound
  const models = modelChain.map((config) => ({
    config,
    instance: new ChatOpenAI({
      apiKey: config.apiKey,
      model: config.model,
      temperature: 0.7,
      streaming: true,
      configuration: { baseURL: config.baseURL },
    }).bindTools(tools),
  }))

  logger.info(
    { chain: modelChain.map((m) => `${m.provider}(${m.model})`) },
    '🔗 model fallback chain',
  )

  // Accepts (state, runnableConfig) — the config MUST be forwarded to the
  // model invocation so LangGraph's token callbacks wire up. Without it,
  // streamMode: 'messages' gets nothing live and buffers the whole response.
  const callModel = async (state: { messages: BaseMessage[] }, runnableConfig?: RunnableConfig) => {
    const systemMsg = new messages.SystemMessage(buildSystemPrompt())
    let lastError: Error | null = null

    for (const { config: modelConfig, instance } of models) {
      try {
        const response = await instance.invoke([systemMsg, ...state.messages], runnableConfig)

        // Log token usage
        const usage = (
          response as {
            usage_metadata?: {
              input_tokens?: number
              output_tokens?: number
              total_tokens?: number
            }
          }
        ).usage_metadata
        if (usage) {
          logger.info(
            {
              provider: modelConfig.provider,
              input: usage.input_tokens,
              output: usage.output_tokens,
              total: usage.total_tokens,
            },
            '📊 token usage',
          )
        }

        return { messages: [response] }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.warn(
          { provider: modelConfig.provider, err: lastError.message },
          '⚠️ model failed, trying next in fallback chain',
        )
      }
    }

    // All models failed
    logger.error({ err: lastError?.message }, 'all models in fallback chain failed')
    return {
      messages: [
        new messages.AIMessage('All models are currently unavailable. Please try again later.'),
      ],
    }
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', createDedupedToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition)
    .addEdge('tools', 'agent')

  return workflow.compile({ checkpointer })
}

export type Agent = ReturnType<typeof buildAgent>
