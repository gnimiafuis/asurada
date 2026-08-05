import { Brain, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Markdown } from './Markdown.js'

type Props = {
  thinking: string
  streaming?: boolean
}

export function ThinkingBlock({ thinking, streaming }: Props) {
  // Open by default while actively thinking; collapse once the answer starts.
  const [open, setOpen] = useState(streaming ?? false)

  // Auto-collapse when the model transitions from thinking → rendering answer.
  useEffect(() => {
    if (!streaming) setOpen(false)
  }, [streaming])

  if (!thinking?.trim()) return null

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain size={13} />
        <span>{streaming ? 'Thinking…' : 'Thought process'}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <Markdown content={thinking} />
        </div>
      )}
    </div>
  )
}
