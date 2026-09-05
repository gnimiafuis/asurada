import { randomUUID } from 'node:crypto'
import * as messages from '@langchain/core/messages'
import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { toolsCondition } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import { env as appEnv } from '../env.js'
import { logger } from '../lib/logger.js'
import { trimContext } from './context.js'
import { getModelChain } from './llm.js'
import { createGuardedToolNode } from './toolPolicy.js'
import { buildTools } from './tools/index.js'

export { messages }

const AGENT_SYSTEM_PROMPT = `You are a helpful AI assistant with web search and scheduling tools.

Rules:
- If you already have search results earlier in this conversation, USE THEM. Do not search again for the same topic.
- Only search when you genuinely lack information you don't already have.
- Pick ONE search tool per query. Only try a different one if the first returned an error or nothing useful.
- If a tool result starts with [DUPLICATE CALL], it is your own earlier result. Use it and respond immediately — do not call tools again.
- For broad or comparison questions needing multiple searches, prefer deep_research over calling search tools repeatedly.
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
 * Provider risk-control rejection detection. Some OpenAI-compatible providers
 * (observed: MiMo) intermittently reject risky-looking contexts by returning
 * a terse rejection notice as a NORMAL streamed response — HTTP 200, no error,
 * no usage metadata. Left undetected it streams to the user then vanishes on
 * refetch (never usefully persisted). Signature: short canned text, no tool
 * calls, no usage.
 */
export function isProviderRejection(res: AIMessage): boolean {
  const text = typeof res.content === 'string' ? res.content.trim() : ''
  if (res.tool_calls?.length) return false
  if (text.length > 0 && text.length < 300 && !res.usage_metadata) {
    return /the request was rejected|considered high risk|risk control|content policy/i.test(text)
  }
  // Model produced literally nothing (empty content, no tool calls) — equally
  // unusable; treat as a provider failure so the fallback chain engages.
  return text.length === 0 && !res.tool_calls?.length && !res.usage_metadata
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
      maxTokens: appEnv.MAX_OUTPUT_TOKENS.agent,
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
    // Deep Research toggle (per-request, from UI) — 'always' directive below;
    // 'never' is ALSO hard-blocked at the tool layer (toolPolicy).
    const drMode = (runnableConfig?.configurable as { deep_research?: boolean } | undefined)
      ?.deep_research
    let systemPrompt = buildSystemPrompt()
    if (drMode === true) {
      systemPrompt +=
        '\n\nDEEP RESEARCH MODE IS ON (user-enabled). For any substantive question, ALWAYS call deep_research — skip it only for greetings or trivial chat.'
    } else if (drMode === false) {
      systemPrompt +=
        '\n\nDeep Research is DISABLED by the user. Do NOT call deep_research under any circumstances — answer directly or use a single regular search tool.'
    }
    const systemMsg = new messages.SystemMessage(systemPrompt)
    let lastError: Error | null = null

    for (const { config: modelConfig, instance } of models) {
      try {
        // Shape the context window: full history stays in the checkpoint,
        // the model sees the trimmed view (see agent/context.ts).
        const visible = trimContext(state.messages)
        const response = await instance.invoke([systemMsg, ...visible], runnableConfig)

        // Provider risk-control rejections masquerade as normal responses —
        // convert to a provider failure so the fallback chain engages
        // instead of streaming a rejection that later vanishes.
        if (isProviderRejection(response)) {
          const text = typeof response.content === 'string' ? response.content.trim() : '(empty)'
          throw new Error(`provider rejection: ${text.slice(0, 120)}`)
        }

        // Harden against empty message ids — LangGraph's add_messages reducer
        // mis-handles them (replace-in-place hazard). Providers occasionally
        // omit ids (observed on MiMo risk rejections).
        if (!response.id) {
          response.id = `ai-${randomUUID()}`
        }

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
        // Abort (user cancel / timeout) is NOT a provider failure —
        // rethrow immediately; never retry an aborted request on a
        // fallback provider (would re-bill a cancelled generation).
        if (err instanceof Error && err.name === 'AbortError') {
          logger.info({ provider: modelConfig.provider }, '⏹ model call aborted')
          throw err
        }
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.warn(
          { provider: modelConfig.provider, err: lastError.message },
          '⚠️ model failed, trying next in fallback chain',
        )
      }
    }

    // All models failed (genuine provider failures only — aborts rethrow above)
    logger.error({ err: lastError?.message }, 'all models in fallback chain failed')
    return {
      messages: [
        new messages.AIMessage(
          `All models are currently unavailable (${lastError?.message?.slice(0, 120) ?? 'unknown error'}). Please try again later.`,
        ),
      ],
    }
  }

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', callModel)
    .addNode('tools', createGuardedToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition)
    .addEdge('tools', 'agent')

  return workflow.compile({ checkpointer })
}

export type Agent = ReturnType<typeof buildAgent>
