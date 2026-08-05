import { Brain, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Markdown } from './Markdown.js'

type Props = {
  thinking: string
  streaming?: boolean
}

export function ThinkingBlock({ thinking, streaming }: Props) {
  const [open, setOpen] = useState(true)

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
