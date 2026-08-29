import { type AIMessage, type BaseMessage, ToolMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { logger } from '../lib/logger.js'

type ToolCall = { name: string; args: Record<string, unknown>; id?: string }

/** Stable serialization of tool args (sorted top-level keys) for duplicate matching. */
function stableKey(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort())
}

function callKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${stableKey(args)}`
}

function makeToolMessage(call: ToolCall, content: string): ToolMessage {
  return new ToolMessage(
    { content, tool_call_id: call.id ?? '', name: call.name },
    call.id ?? '',
    call.name,
  )
}

/**
 * Custom tool node: dedup replay + Deep Research policy + PARALLEL batch
 * execution.
 *
 * When the model batches multiple tool_calls in one AIMessage, all calls
 * that pass policy run CONCURRENTLY (Promise.allSettled) instead of
 * sequentially — matching LangGraph's prebuilt ToolNode behavior.
 *
 * Pass 1 (sync, per call, in pending order):
 *   - duplicate of an earlier call in this invocation → replay previous result
 *   - unknown tool → error message
 *   - Deep Research OFF policy → bounce deep_research
 *   - Deep Research ON policy → bounce bare *_search until research ran
 *   - identical sibling earlier IN THE SAME BATCH → replay sibling's result
 *   - otherwise → queued for execution
 * Pass 2 (parallel): queued calls execute via Promise.allSettled, errors
 * captured per call. Outputs assembled in the model's original order.
 *
 * Scope: only messages after the last HumanMessage count as history, so
 * scheduled tasks firing later with the same query start fresh.
 */
export function createDedupedToolNode(tools: StructuredToolInterface[]) {
  const fallbackNode = new ToolNode(tools)
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  return async function dedupedToolsNode(
    state: { messages: BaseMessage[] },
    runnableConfig?: RunnableConfig,
  ): Promise<{
    messages: ToolMessage[]
  }> {
    const msgs = state.messages
    const last = msgs[msgs.length - 1] as AIMessage | undefined
    const pendingCalls = (last?.tool_calls ?? []) as ToolCall[]

    // Fast path: no pending calls → delegate to the standard ToolNode
    if (!last || last._getType() !== 'ai' || pendingCalls.length === 0) {
      const result = (await fallbackNode.invoke(state, runnableConfig)) as {
        messages: ToolMessage[]
      }
      return { messages: result.messages }
    }

    // Scope window: everything after the last HumanMessage
    let lastHumanIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]?._getType() === 'human') {
        lastHumanIdx = i
        break
      }
    }

    // Build history: toolCallId → result content (from ToolMessages)
    const resultByCallId = new Map<string, string>()
    let hasDeepResearchResult = false
    for (let i = lastHumanIdx + 1; i < msgs.length; i++) {
      const m = msgs[i]
      if (m?._getType() === 'tool') {
        const tm = m as ToolMessage
        resultByCallId.set(tm.tool_call_id, typeof tm.content === 'string' ? tm.content : '')
        if (tm.name === 'deep_research') hasDeepResearchResult = true
      }
    }

    // Build history: callKey → toolCallId (from executed AI tool_calls)
    const executedKeys = new Map<string, string>()
    for (let i = lastHumanIdx + 1; i < msgs.length - 1; i++) {
      const m = msgs[i]
      if (m?._getType() !== 'ai') continue
      for (const tc of (m as AIMessage).tool_calls ?? []) {
        if (tc.id) executedKeys.set(callKey(tc.name, tc.args as Record<string, unknown>), tc.id)
      }
    }

    const drMode = (runnableConfig?.configurable as { deep_research?: boolean } | undefined)
      ?.deep_research

    // ── Pass 1 (sync): classify every pending call ──
    type Exec = { call: ToolCall; key: string; tool: StructuredToolInterface }
    const resolved: Array<ToolMessage | null> = [] // sync-resolved messages, in order
    const toExecute: Exec[] = []
    const batchKeys = new Map<string, string>() // key → callId of first occurrence in batch

    for (const call of pendingCalls) {
      if (!call.id) {
        resolved.push(null)
        continue
      }
      const key = callKey(call.name, call.args)

      // Duplicate of an earlier call in this invocation → replay
      const prevCallId = executedKeys.get(key)
      if (prevCallId) {
        const prevContent = resultByCallId.get(prevCallId) ?? '(previous result unavailable)'
        logger.info({ tool: call.name }, '↻ duplicate tool call replayed')
        resolved.push(
          makeToolMessage(
            call,
            `[DUPLICATE CALL] You already called ${call.name} with these exact arguments in this conversation. Previous result:\n\n${prevContent}\n\nUse this result and respond now — do not call this tool again.`,
          ),
        )
        continue
      }

      // Unknown tool
      const tool = toolMap.get(call.name)
      if (!tool) {
        resolved.push(makeToolMessage(call, `Error: tool "${call.name}" not found.`))
        continue
      }

      // Policy: Deep Research hard-off
      if (drMode === false && call.name === 'deep_research') {
        logger.info('🚫 deep_research blocked (disabled by user toggle)')
        resolved.push(
          makeToolMessage(
            call,
            'Deep Research is disabled by the user. Do NOT call deep_research again — answer directly or use a single regular search tool.',
          ),
        )
        continue
      }

      // Policy: Deep Research hard-on — redirect bare searches until research ran
      if (
        drMode === true &&
        call.name.endsWith('_search') &&
        call.name !== 'deep_research' &&
        !hasDeepResearchResult
      ) {
        logger.info({ tool: call.name }, '↪ search redirected to deep_research (mode ON)')
        resolved.push(
          makeToolMessage(
            call,
            "Deep Research mode is ON (user-enabled): do NOT use individual search tools. Call deep_research with the user's question instead — it fans out multiple searches and synthesizes a cited report.",
          ),
        )
        continue
      }

      // Identical sibling earlier in the SAME batch → replay it after execution
      const batchFirstId = batchKeys.get(key)
      if (batchFirstId) {
        resolved.push(
          makeToolMessage(
            call,
            `[DUPLICATE CALL] Identical to another call in this same batch (id ${batchFirstId}). That result applies here too — do not call this tool again.`,
          ),
        )
        continue
      }

      batchKeys.set(key, call.id)
      resolved.push(null) // placeholder — filled after execution
      toExecute.push({ call, key, tool })
    }

    // ── Pass 2 (parallel): execute all queued calls concurrently ──
    const results = await Promise.allSettled(
      toExecute.map(async ({ call, tool }) => {
        const result = await tool.invoke(call.args, runnableConfig)
        return typeof result === 'string' ? result : JSON.stringify(result)
      }),
    )

    const execContent = new Map<string, string>() // callId → content
    for (let i = 0; i < toExecute.length; i++) {
      const exec = toExecute[i]
      const settled = results[i]
      if (!exec || !settled) continue
      const { call, key } = exec
      let content: string
      if (settled.status === 'fulfilled') {
        content = settled.value
        execContent.set(call.id ?? '', content)
        executedKeys.set(key, call.id ?? '')
      } else {
        const errMsg =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
        logger.warn({ tool: call.name, err: errMsg }, 'tool execution failed')
        content = `Error executing ${call.name}: ${errMsg}`
      }
      // Fill the placeholder at the call's original position
      const idx = pendingCalls.findIndex((c) => c.id === call.id)
      if (idx >= 0) resolved[idx] = makeToolMessage(call, content)
    }

    return { messages: resolved.filter((m): m is ToolMessage => m !== null) }
  }
}
