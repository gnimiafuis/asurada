import { Bot } from 'lucide-react'
import { memo } from 'react'

type Props = {
  sender: 'user' | 'assistant' | 'system'
  content: string
}

function MessageBubbleImpl({ sender, content }: Props) {
  const isUser = sender === 'user'

  if (isUser) {
    // Right-aligned bubble — messenger style
    return (
      <div className="cv-auto flex justify-end px-4 py-2.5 sm:px-6">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-sm">
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</div>
        </div>
      </div>
    )
  }

  // Left-aligned with avatar for the assistant
  return (
    <div className="cv-auto flex gap-3 px-4 py-2.5 sm:px-6">
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot size={15} />
      </div>
      <div className="min-w-0 max-w-[80%] flex-1 pt-0.5">
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {content}
        </div>
      </div>
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleImpl)
