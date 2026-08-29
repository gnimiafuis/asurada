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

/* ─────────────────────────────────────────────────────────────
 * Tool policy guards
 * Each returns bounce content (string) to veto the call, or null to allow.
 * ───────────────────────────────────────────────────────────── */

/** Duplicate of an earlier executed call in this invocation → replay it. */
function duplicateReplayGuard(
  call: ToolCall,
  key: string,
  executedKeys: Map<string, string>,
  resultByCallId: Map<string, string>,
): string | null {
  const prevCallId = executedKeys.get(key)
  if (!prevCallId) return null
  const prevContent = resultByCallId.get(prevCallId) ?? '(previous result unavailable)'
  logger.info({ tool: call.name }, '↻ duplicate tool call replayed')
  return `[DUPLICATE CALL] You already called ${call.name} with these exact arguments in this conversation. Previous result:\n\n${prevContent}\n\nUse this result and respond now — do not call this tool again.`
}

/** Deep Research toggle OFF (UI): deep_research is hard-blocked. */
function deepResearchOffGuard(call: ToolCall, drMode: boolean | undefined): string | null {
  if (drMode !== false || call.name !== 'deep_research') return null
  logger.info('🚫 deep_research blocked (disabled by user toggle)')
  return 'Deep Research is disabled by the user. Do NOT call deep_research again — answer directly or use a single regular search tool.'
}

/** Deep Research toggle ON (UI): bare *_search redirected until research ran. */
function deepResearchOnGuard(
  call: ToolCall,
  drMode: boolean | undefined,
  hasDeepResearchResult: boolean,
): string | null {
  if (drMode !== true || !call.name.endsWith('_search') || call.name === 'deep_research') {
    return null
  }
  if (hasDeepResearchResult) return null
  logger.info({ tool: call.name }, '↪ search redirected to deep_research (mode ON)')
  return "Deep Research mode is ON (user-enabled): do NOT use individual search tools. Call deep_research with the user's question instead — it fans out multiple searches and synthesizes a cited report."
}

/**
 * Guarded tool node — the agent's tool policy layer.
 *
 * Responsibilities (in evaluation order per pending call):
 * 1. Duplicate replay — same tool + exact args earlier in this invocation
 *    → replay previous result, zero API cost
 * 2. Deep Research OFF policy — deep_research hard-blocked
 * 3. Deep Research ON policy — bare *_search redirected until research ran
 * 4. Batch-sibling dedup — identical call earlier in the SAME batch → replay
 * 5. Unknown tool → error message
 * 6. Everything else → executed, with all calls in a batch running in
 *    PARALLEL via Promise.allSettled (per-call error capture, outputs
 *    reassembled in the model's original call order)
 *
 * History scope: only messages after the last HumanMessage count, so
 * scheduled tasks firing later with the same query start fresh.
 * Failover preserved: a different tool with the same args is a different
 * key and executes normally.
 */
export function createGuardedToolNode(tools: StructuredToolInterface[]) {
  const fallbackNode = new ToolNode(tools)
  const toolMap = new Map(tools.map((t) => [t.name, t]))

  return async function guardedToolNode(
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

    // History: toolCallId → result content + whether research already ran
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

    // History: callKey → toolCallId (from executed AI tool_calls)
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

    // ── Pass 1 (sync): run every guard, classify each pending call ──
    const resolved: Array<ToolMessage | null> = [] // sync-resolved, in order
    const toExecute: Array<{ call: ToolCall; key: string }> = []
    const batchKeys = new Map<string, string>() // key → callId of first occurrence in batch

    for (const call of pendingCalls) {
      if (!call.id) {
        resolved.push(null)
        continue
      }
      const key = callKey(call.name, call.args)

      const bounce =
        duplicateReplayGuard(call, key, executedKeys, resultByCallId) ??
        deepResearchOffGuard(call, drMode) ??
        deepResearchOnGuard(call, drMode, hasDeepResearchResult)
      if (bounce) {
        resolved.push(makeToolMessage(call, bounce))
        continue
      }

      // Unknown tool
      if (!toolMap.has(call.name)) {
        resolved.push(makeToolMessage(call, `Error: tool "${call.name}" not found.`))
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
      toExecute.push({ call, key })
    }

    // ── Pass 2 (parallel): execute all queued calls concurrently ──
    const results = await Promise.allSettled(
      toExecute.map(async ({ call }) => {
        const t = toolMap.get(call.name)
        const result = await t?.invoke(call.args, runnableConfig)
        return typeof result === 'string' ? result : JSON.stringify(result)
      }),
    )

    for (let i = 0; i < toExecute.length; i++) {
      const exec = toExecute[i]
      const settled = results[i]
      if (!exec || !settled) continue
      const { call, key } = exec
      let content: string
      if (settled.status === 'fulfilled') {
        content = settled.value
      } else {
        const errMsg =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
        logger.warn({ tool: call.name, err: errMsg }, 'tool execution failed')
        content = `Error executing ${call.name}: ${errMsg}`
      }
      executedKeys.set(key, call.id ?? '')
      // Fill the placeholder at the call's original position
      const idx = pendingCalls.findIndex((c) => c.id === call.id)
      if (idx >= 0) resolved[idx] = makeToolMessage(call, content)
    }

    return { messages: resolved.filter((m): m is ToolMessage => m !== null) }
  }
}
