import { trimMessages } from '@langchain/core/messages'
import * as messages from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { logger } from '../lib/logger.js'
import { createLlm } from './llm.js'
import { buildTools } from './tools/index.js'

export { messages }

export const AGENT_SYSTEM_PROMPT = `You are a helpful, knowledgeable AI assistant with access to web search tools.

Guidelines:
- When you don't know something or need current information, use the available search tools to find accurate, up-to-date answers.
- Always base your responses on search results when dealing with factual or time-sensitive queries.
- Be concise but thorough. Use markdown formatting for readability.
- When you use search results, cite your sources with URLs.
- If multiple search tools are available, pick the most appropriate one for the query rather than calling all of them.`

/** Constructs the full system prompt with a fresh timestamp on every call. */
export function buildSystemPrompt(): string {
  const DATE_TIME_SYSTEM_PROMPT = `Current date and time (UTC): ${new Date().toISOString()}`
  return `${AGENT_SYSTEM_PROMPT}\n\n${DATE_TIME_SYSTEM_PROMPT}`
}

/** Max tokens of conversation history to send to the LLM (excludes system prompt).
 *  Keeps the most recent messages, drops older ones. Prevents context overflow
 *  on long conversations and scheduled-task threads that accumulate over time. */
const MAX_HISTORY_TOKENS = 8000

/**
 * Build a tool-calling LangGraph agent with checkpointing.
 *
 * The graph loops: agent → (wants tools?) → tools → agent → ... → (no tools?) → END
 * The LLM decides which tool to call based on the query. Each search tool
 * is registered conditionally based on which API keys are set.
 */
export function buildAgent(
  checkpointer: PostgresSaver,
  env: { TAVILY_API_KEY?: string; EXA_API_KEY?: string; FIRECRAWL_API_KEY?: string },
) {
  const tools = buildTools(env)
  const baseModel = createLlm()
  const model = baseModel.bindTools(tools)

  const callModel = async (state: { messages: BaseMessage[] }) => {
    try {
      // Trim conversation history to prevent context overflow + cost
      const trimmed = await trimMessages(state.messages, {
        maxTokens: MAX_HISTORY_TOKENS,
        strategy: 'last',
        includeSystem: false,
        startOn: 'human',
        tokenCounter: baseModel,
      })

      const response = await model.invoke([
        new messages.SystemMessage(buildSystemPrompt()),
        ...trimmed,
      ])

      // Log token usage for cost visibility
      const usage = (
        response as {
          usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
        }
      ).usage_metadata
      if (usage) {
        logger.info(
          { input: usage.input_tokens, output: usage.output_tokens, total: usage.total_tokens },
          '📊 token usage',
        )
      }

      return { messages: [response] }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      logger.error({ err: errorMsg }, 'agent LLM call failed')
      return {
        messages: [
          new messages.AIMessage(
            `I encountered an error while processing your request (${errorMsg}). Please try again.`,
          ),
        ],
      }
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
