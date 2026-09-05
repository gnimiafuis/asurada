import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { env } from '../env.js'
import { logger } from '../lib/logger.js'

/**
 * Context window shaping — runs per LLM call in callModel.
 *
 * Shapes ONLY what the model sees; the Postgres checkpoint keeps full
 * history forever (dedup replay, rewind, memory extraction, and the
 * messages API all read the checkpoint, never this view).
 *
 * Policy:
 * 1. Under budget → send everything verbatim (most threads never trim)
 * 2. Over budget → FLOOR: everything from the 2nd-to-last human message
 *    onward stays verbatim (even if the floor alone exceeds budget —
 *    cutting it would break the current turn's tool_call pairing)
 * 3. Prefix (older turns): tool results > TOOL_RESULT_TRIM_CHARS get
 *    truncated (the assistant's own reply already summarizes each turn —
 *    old raw tool output is the bulk and the least valuable verbatim)
 * 4. Still over budget → drop oldest prefix messages; leading orphaned
 *    ToolMessages are dropped too (API 400s on tool results whose
 *    tool_call was removed)
 */

/** Cheap estimate: chars/3 overestimates English ~33% (trims slightly early — fine) and stays within ~2x for CJK. */
function charsToTokens(chars: number): number {
  return Math.ceil(chars / 3)
}

function messageTokens(m: BaseMessage): number {
  let chars = typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length
  if (m instanceof AIMessage) {
    for (const tc of m.tool_calls ?? []) chars += JSON.stringify(tc.args ?? {}).length
  }
  return charsToTokens(chars)
}

export function trimContext(msgs: BaseMessage[]): BaseMessage[] {
  const budget = env.CONTEXT_TOKEN_BUDGET
  const trimChars = env.TOOL_RESULT_TRIM_CHARS

  const totalBefore = msgs.reduce((s, m) => s + messageTokens(m), 0)
  if (totalBefore <= budget) return msgs

  // Locate the floor: start of the 2nd-to-last human message
  let floorStart = 0
  let humansSeen = 0
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] instanceof HumanMessage) {
      humansSeen++
      if (humansSeen === 2) {
        floorStart = i
        break
      }
    }
  }
  if (floorStart === 0) {
    // Fewer than 2 turns — nothing safely droppable
    logger.warn({ total: totalBefore, budget }, '✂️ context over budget but <2 turns — sending full')
    return msgs
  }

  const floor = msgs.slice(floorStart)
  const floorTokens = floor.reduce((s, m) => s + messageTokens(m), 0)

  // Step 1: asymmetric compression — truncate bulky old tool results
  const prefix: BaseMessage[] = msgs.slice(0, floorStart).map((m) => {
    if (m instanceof ToolMessage) {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      if (content.length > trimChars) {
        const truncated = `${content.slice(0, trimChars)}\n[…older tool result trimmed]`
        return new ToolMessage(
          { content: truncated, tool_call_id: m.tool_call_id, name: m.name },
          m.tool_call_id,
          m.name,
        )
      }
    }
    return m
  })

  const prefixTokens = () => prefix.reduce((s, m) => s + messageTokens(m), 0)

  // Step 2: drop oldest prefix messages until within budget (floor is never cut)
  while (prefix.length > 0 && prefixTokens() + floorTokens > budget) {
    prefix.shift()
    // Orphan safety: a ToolMessage whose AI tool_call was dropped → API 400
    while (prefix.length > 0 && prefix[0] instanceof ToolMessage) prefix.shift()
  }

  const totalAfter = prefixTokens() + floorTokens
  logger.info(
    {
      messages: `${prefix.length + floor.length}/${msgs.length}`,
      estTokens: `${totalAfter}/${totalBefore}`,
      budget,
    },
    '✂️ context trimmed',
  )

  return [...prefix, ...floor]
}
