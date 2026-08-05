import { Bot, User } from 'lucide-react'
import { memo } from 'react'

type Props = {
  sender: 'user' | 'assistant' | 'system'
  content: string
}

// `memo` means each bubble only re-renders when ITS props change — during
// streaming only the active streaming bubble updates, not the whole list.
// `.cv-auto` adds CSS content-visibility so off-screen bubbles are skipped
// entirely by the browser's compositor — handles hundreds of messages.
function MessageBubbleImpl({ sender, content }: Props) {
  const isUser = sender === 'user'

  return (
    <div className="cv-auto flex gap-3 px-4 py-5 sm:px-6">
      <div
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        }`}
      >
        {isUser ? <User size={15} /> : <Bot size={15} />}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {isUser ? 'You' : 'Assistant'}
        </div>
        <div className="prose prose-sm max-w-none whitespace-pre-wrap break-words text-foreground dark:prose-invert">
          {content}
        </div>
      </div>
    </div>
  )
}

export const MessageBubble = memo(MessageBubbleImpl)
