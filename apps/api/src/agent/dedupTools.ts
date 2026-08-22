import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import { ToolMessage } from '@langchain/core/messages'
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

/**
 * Custom tool node that replays previous results for duplicate calls.
 *
 * When the agent calls the same tool with the exact same arguments twice
 * within one invocation (between HumanMessages), the duplicate is NOT
 * executed — instead a synthetic ToolMessage returns the previous result
 * with a DUPLICATE CALL marker, telling the LLM to respond immediately.
 *
 * Scope: only messages after the last HumanMessage are considered, so
 * scheduled tasks firing later with the same query start fresh.
 *
 * Failover is preserved: a DIFFERENT tool with the same args (e.g.
 * exa_search after tavily_search failed) is a different key and executes.
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
    for (let i = lastHumanIdx + 1; i < msgs.length; i++) {
      const m = msgs[i]
      if (m?._getType() === 'tool') {
        const tm = m as ToolMessage
        resultByCallId.set(tm.tool_call_id, typeof tm.content === 'string' ? tm.content : '')
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

    const outputs: ToolMessage[] = []

    for (const call of pendingCalls) {
      if (!call.id) continue
      const key = callKey(call.name, call.args)

      const prevCallId = executedKeys.get(key)
      if (prevCallId) {
        // Duplicate: replay the previous result without executing
        const prevContent = resultByCallId.get(prevCallId) ?? '(previous result unavailable)'
        logger.info({ tool: call.name }, '↻ duplicate tool call replayed')
        outputs.push(
          new ToolMessage(
            {
              content: `[DUPLICATE CALL] You already called ${call.name} with these exact arguments in this conversation. Previous result:\n\n${prevContent}\n\nUse this result and respond now — do not call this tool again.`,
              tool_call_id: call.id,
              name: call.name,
            },
            call.id,
            call.name,
          ),
        )
        continue
      }

      // Not a duplicate: execute the tool directly
      const tool = toolMap.get(call.name)
      if (!tool) {
        outputs.push(
          new ToolMessage(
            {
              content: `Error: tool "${call.name}" not found.`,
              tool_call_id: call.id,
              name: call.name,
            },
            call.id,
            call.name,
          ),
        )
        continue
      }

      try {
        const result = await tool.invoke(call.args, runnableConfig)
        const content = typeof result === 'string' ? result : JSON.stringify(result)
        outputs.push(
          new ToolMessage({ content, tool_call_id: call.id, name: call.name }, call.id, call.name),
        )
        // Register so an identical sibling call in the same batch replays
        executedKeys.set(key, call.id)
        resultByCallId.set(call.id, content)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        logger.warn({ tool: call.name, err: errMsg }, 'tool execution failed')
        outputs.push(
          new ToolMessage(
            {
              content: `Error executing ${call.name}: ${errMsg}`,
              tool_call_id: call.id,
              name: call.name,
            },
            call.id,
            call.name,
          ),
        )
      }
    }

    return { messages: outputs }
  }
}
