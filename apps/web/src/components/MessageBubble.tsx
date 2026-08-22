import { Bot, User } from 'lucide-react'
import { memo } from 'react'
import { Markdown } from './Markdown.js'
import { ThinkingBlock } from './ThinkingBlock.js'
import { type ToolCall, ToolCallsBlock, type ToolResult } from './ToolCallsBlock.js'

type Props = {
  sender: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  thinkingStreaming?: boolean
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  toolsStreaming?: boolean
  subProgress?: { phase: string; done: number; total: number } | null
}

function MessageBubbleImpl({
  sender,
  content,
  thinking,
  thinkingStreaming,
  toolCalls,
  toolResults,
  toolsStreaming,
  subProgress,
}: Props) {
  const isUser = sender === 'user'

  if (isUser) {
    return (
      <div className="cv-auto flex flex-row-reverse gap-3 px-4 py-3 sm:px-6">
        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
          <User size={15} />
        </div>
        <div className="min-w-0 max-w-[80%] flex-1 pt-0.5 text-right">
          <div className="mb-1 text-xs font-medium text-muted-foreground">You</div>
          <div className="ml-auto inline-block whitespace-pre-wrap break-words text-left text-foreground">
            {content}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="cv-auto flex gap-3 px-4 py-3 sm:px-6">
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-muted text-foreground">
        <Bot size={15} />
      </div>
      <div className="min-w-0 max-w-[80%] flex-1 pt-0.5">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Assistant</div>
        {toolCalls && toolCalls.length > 0 && (
          <ToolCallsBlock
            calls={toolCalls}
            results={toolResults ?? []}
            streaming={toolsStreaming}
            subProgress={subProgress}
          />
        )}
        {thinking && <ThinkingBlock thinking={thinking} streaming={thinkingStreaming} />}
        {content && <Markdown content={content} />}
      </div>
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleImpl)
