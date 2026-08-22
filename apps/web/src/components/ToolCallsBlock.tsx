import { ChevronDown, Search, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Markdown } from './Markdown.js'

export type ToolCall = {
  name: string
  args?: string
}

export type ToolResult = {
  name: string
  content: string
}

type Props = {
  calls: ToolCall[]
  results: ToolResult[]
  streaming?: boolean
  subProgress?: { phase: string; done: number; total: number } | null
}

const TOOL_ICONS: Record<string, typeof Search> = {
  tavily_search: Search,
  exa_search: Search,
  duckduckgo_search: Search,
  firecrawl_search: Search,
  firecrawl_scrape: Wrench,
  deep_research: Search,
}

const TOOL_LABELS: Record<string, string> = {
  tavily_search: 'Tavily',
  exa_search: 'Exa',
  duckduckgo_search: 'DuckDuckGo',
  firecrawl_search: 'Firecrawl',
  firecrawl_scrape: 'Firecrawl Scrape',
  deep_research: 'Deep Research',
}

const PHASE_LABELS: Record<string, string> = {
  planning: 'planning',
  searching: 'searching',
  synthesizing: 'synthesizing',
  done: 'complete',
}

export function ToolCallsBlock({ calls, results, streaming, subProgress }: Props) {
  // Auto-collapse when the answer starts rendering (toolsStreaming → false)
  const [open, setOpen] = useState(streaming ?? false)

  useEffect(() => {
    if (!streaming) setOpen(false)
  }, [streaming])

  if (calls.length === 0) return null

  // Subagent live status line, e.g. "Deep Research — searching 2/4"
  const hasDeepResearch = calls.some((c) => c.name === 'deep_research')
  const statusLabel = () => {
    if (streaming && hasDeepResearch && subProgress) {
      const phase = PHASE_LABELS[subProgress.phase] ?? subProgress.phase
      if (subProgress.phase === 'searching' && subProgress.total > 0) {
        return `Deep Research — ${phase} ${subProgress.done}/${subProgress.total}`
      }
      return `Deep Research — ${phase}`
    }
    return streaming ? 'Searching…' : `Searched (${calls.length})`
  }

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <Search size={13} />
        <span>{statusLabel()}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {calls.map((call, i) => {
            const Icon = TOOL_ICONS[call.name] ?? Wrench
            const label = TOOL_LABELS[call.name] ?? call.name
            const result = results.find((r) => r.name === call.name)
            return (
              <div
                key={`${call.name}-${i}`}
                className="rounded-lg border border-border/50 bg-muted/30 p-2.5 text-xs"
              >
                <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                  <Icon size={12} />
                  {label}
                  {call.args && (
                    <span className="font-mono text-muted-foreground">{call.args}</span>
                  )}
                </div>
                {result && (
                  <div className="max-h-40 overflow-y-auto text-muted-foreground">
                    <Markdown content={result.content} />
                  </div>
                )}
                {!result && streaming && (
                  <div className="text-muted-foreground italic">Fetching results…</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
