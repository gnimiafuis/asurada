import type { BaseMessage } from '@langchain/core/messages'

/** Extract reasoning + content text from a streaming chunk or message. */
export function extractChunk(chunk: BaseMessage): { thinking?: string; content?: string } {
  let thinking: string | undefined
  let content: string | undefined

  // Reasoning from additional_kwargs (DeepSeek/MiniMax M3 style)
  const reasoning = (chunk.additional_kwargs as Record<string, unknown> | undefined)
    ?.reasoning_content
  if (typeof reasoning === 'string' && reasoning) {
    thinking = reasoning
  }

  // Content
  if (typeof chunk.content === 'string') {
    content = chunk.content
  } else if (Array.isArray(chunk.content)) {
    for (const part of chunk.content) {
      if (typeof part === 'object' && part !== null && 'type' in part) {
        if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
          content = (content ?? '') + part.text
        } else if (
          part.type === 'reasoning' &&
          'reasoning' in part &&
          typeof part.reasoning === 'string'
        ) {
          thinking = (thinking ?? '') + part.reasoning
        }
      }
    }
  }

  return { thinking: thinking || undefined, content: content || undefined }
}
