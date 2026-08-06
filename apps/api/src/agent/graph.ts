import * as messages from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import { logger } from '../lib/logger.js'
import { getModelChain } from './llm.js'
import { buildTools } from './tools/index.js'

export { messages }

export const AGENT_SYSTEM_PROMPT = `You are a helpful, knowledgeable AI assistant with access to web search tools and task scheduling.

Guidelines:
- When you don't know something or need current information, use the available search tools to find accurate, up-to-date answers.
- Always base your responses on search results when dealing with factual or time-sensitive queries.
- Be concise but thorough. Use markdown formatting for readability.
- When you use search results, cite your sources with URLs.
- If multiple search tools are available, pick the most appropriate one for the query rather than calling all of them.
- When the user asks to schedule something ("in 2 hours", "remind me tomorrow", "after 30 min", "at 3pm"), use delay_task with the delay in seconds (1min=60, 1hr=3600, 1day=86400).
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

  const callModel = async (state: { messages: BaseMessage[] }) => {
    const systemMsg = new messages.SystemMessage(buildSystemPrompt())
    let lastError: Error | null = null

    for (const { config, instance } of models) {
      try {
        const response = await instance.invoke([systemMsg, ...state.messages])

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
              provider: config.provider,
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
          { provider: config.provider, err: lastError.message },
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
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition)
    .addEdge('tools', 'agent')

  return workflow.compile({ checkpointer })
}

export type Agent = ReturnType<typeof buildAgent>
