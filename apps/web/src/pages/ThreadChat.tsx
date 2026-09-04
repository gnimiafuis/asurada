import type { Message, Schedule } from '@asurada/shared'
import { ArrowDown, ArrowUp, Bot, Clock, Repeat, Square, Telescope, Timer, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MessageBubble } from '../components/MessageBubble.js'
import type { ToolCall, ToolResult } from '../components/ToolCallsBlock.js'
import { apiFetch } from '../lib/api.js'

type ThreadMeta = { id: string; title: string }

const SCROLL_PIN_THRESHOLD = 120 // px from bottom to consider "pinned"

export function ThreadChat() {
  const { id } = useParams<{ id: string }>()
  const [meta, setMeta] = useState<ThreadMeta | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [streamingThinking, setStreamingThinking] = useState('')
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCall[]>([])
  const [streamingToolResults, setStreamingToolResults] = useState<ToolResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [, setNow] = useState(Date.now()) // tick for countdown
  // Subagent liveness: {phase, done, total} heartbeat from deep_research
  const [subProgress, setSubProgress] = useState<{
    phase: string
    done: number
    total: number
  } | null>(null)
  // Deep Research toggle: off = never trigger, on = always trigger (persisted)
  const [deepResearch, setDeepResearch] = useState(
    () => localStorage.getItem('deep-research') === 'on',
  )

  const toggleDeepResearch = () => {
    setDeepResearch((v) => {
      const next = !v
      localStorage.setItem('deep-research', next ? 'on' : 'off')
      return next
    })
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  // Autofocus target — refocused after every run completes so the user can keep typing
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Refocus when a run ends (busy → false). Doing it inside the event
  // handlers races React's re-render: the textarea is still disabled at
  // focus() time, which is a silent no-op. The effect fires AFTER the
  // re-render, so the focus lands.
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (wasBusyRef.current && !busy) {
      inputRef.current?.focus()
    }
    wasBusyRef.current = busy
  }, [busy])
  // Ref (not state) — avoids re-render on every scroll event
  const pinnedRef = useRef(true)
  // State — only toggles when pin status changes, to show the jump button
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    pinnedRef.current = true
    setShowJump(false)
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior })
  }, [])

  /** Refetch thread metadata + messages from server truth (heal paths). */
  const refetchThread = useCallback(() => {
    if (!id) return
    apiFetch<ThreadMeta & { messages: Message[] }>(`/threads/${id}`)
      .then((t) => {
        setMeta({ id: t.id, title: t.title })
        setMessages(t.messages)
      })
      .catch(() => {})
  }, [id])

  /** Remove the most recent user message (cancelled turn / failed enqueue). */
  const removeLastUserMessage = useCallback((prev: Message[]): Message[] => {
    const lastUser = [...prev].reverse().findIndex((m) => m.role === 'user')
    if (lastUser === -1) return prev
    const idx = prev.length - 1 - lastUser
    return [...prev.slice(0, idx), ...prev.slice(idx + 1)]
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isPinned = distanceFromBottom < SCROLL_PIN_THRESHOLD
    pinnedRef.current = isPinned
    setShowJump((prev) => (prev === !isPinned ? prev : !isPinned))
  }, [])

  // Reset on thread switch — always start pinned, refocus input
  useEffect(() => {
    if (!id) return
    setMeta(null)
    setMessages([])
    setError(null)
    pinnedRef.current = true
    setShowJump(false)
    inputRef.current?.focus()
    apiFetch<ThreadMeta & { messages: Message[] }>(`/threads/${id}`)
      .then((t) => {
        setMeta({ id: t.id, title: t.title })
        setMessages(t.messages)
      })
      .catch((e: Error) => setError(e.message))
    // Load schedules for this thread
    apiFetch<Schedule[]>(`/threads/${id}/schedules`)
      .then(setSchedules)
      .catch(() => {})
  }, [id])

  // Countdown tick — re-render every 1s when there are active schedules
  useEffect(() => {
    if (schedules.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [schedules.length])

  // SSE: listen for real-time thread updates (scheduled task results streamed)
  useEffect(() => {
    if (!id) return
    const baseUrl = import.meta.env.VITE_API_URL ?? ''
    const es = new EventSource(`${baseUrl}/threads/${id}/events`, { withCredentials: true })

    // Accumulate streaming text in closure-scoped variables (same pattern
    // as the POST streaming handler)
    let assistantText = ''
    let thinkingText = ''
    let toolCalls: ToolCall[] = []
    let toolResults: ToolResult[] = []
    let scrollPending = false
    const requestScroll = () => {
      if (!scrollPending) {
        scrollPending = true
        requestAnimationFrame(() => {
          scrollPending = false
          if (pinnedRef.current) {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
          }
        })
      }
    }

    es.addEventListener('stream-start', () => {
      assistantText = ''
      thinkingText = ''
      toolCalls = []
      toolResults = []
      setBusy(true)
      setStreaming('')
      setStreamingThinking('')
      setStreamingToolCalls([])
      setStreamingToolResults([])
      pinnedRef.current = true
      setShowJump(false)
      requestScroll()
    })

    es.addEventListener('thinking-start', (e) => {
      // New thinking segment (agent-loop iteration) — separate from previous
      if (thinkingText !== '') thinkingText += '\n\n---\n\n'
      thinkingText += (JSON.parse(e.data) as { text?: string }).text ?? ''
      setStreamingThinking(thinkingText)
      requestScroll()
    })

    es.addEventListener('thinking-token', (e) => {
      thinkingText += (JSON.parse(e.data) as { text?: string }).text ?? ''
      setStreamingThinking(thinkingText)
    })

    es.addEventListener('tool-call', (e) => {
      const parsed = JSON.parse(e.data) as { name: string; args?: string }
      toolCalls = [...toolCalls, { name: parsed.name, args: parsed.args }]
      setStreamingToolCalls(toolCalls)
      requestScroll()
    })

    es.addEventListener('tool-result', (e) => {
      const parsed = JSON.parse(e.data) as { name: string; content: string }
      toolResults = [...toolResults, parsed]
      setStreamingToolResults(toolResults)
      requestScroll()
    })

    // Subagent heartbeat (deep_research liveness)
    es.addEventListener('sub-progress', (e) => {
      const p = JSON.parse(e.data) as { phase: string; done: number; total: number }
      setSubProgress(p)
      requestScroll()
    })

    es.addEventListener('token', (e) => {
      assistantText += (JSON.parse(e.data) as { text?: string }).text ?? ''
      setStreaming(assistantText)
      requestScroll()
    })

    es.addEventListener('stream-done', () => {
      // Guard: error path also emits stream-done — don't commit an empty
      // bubble when nothing streamed
      if (assistantText || thinkingText) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: assistantText,
            thinking: thinkingText || undefined,
          },
        ])
      }
      setStreaming('')
      setStreamingThinking('')
      setStreamingToolCalls([])
      setStreamingToolResults([])
      setSubProgress(null)
      setBusy(false)
      requestScroll()
    })

    // Worker rewound the cancelled turn server-side — mirror in UI:
    // remove the optimistic user message and clear all stream state
    es.addEventListener('cancelled', () => {
      setMessages(removeLastUserMessage)
      setStreaming('')
      setStreamingThinking('')
      setStreamingToolCalls([])
      setStreamingToolResults([])
      setSubProgress(null)
      setBusy(false)
    })

    // Agent failure (SSE 'error' data event — NOT the connection error,
    // which has no data and is handled by es.onerror)
    es.addEventListener('error', (e) => {
      const data = (e as MessageEvent).data
      if (!data) return // connection error — auto-reconnect handles it
      const parsed = JSON.parse(data as string) as { message?: string }
      setError(parsed.message ?? 'Agent failed to respond.')
      setStreaming('')
      setStreamingThinking('')
      setStreamingToolCalls([])
      setStreamingToolResults([])
      setSubProgress(null)
      setBusy(false)
    })

    // A run just finished (or a schedule fired) — server truth is now
    // authoritative. Refetch MESSAGES too: if any stream events were lost
    // (fire-and-forget pub/sub), this lands the completed answer in the UI
    // instead of leaving the user's message unanswered.
    es.addEventListener('thread-updated', () => {
      refetchThread()
      apiFetch<Schedule[]>(`/threads/${id}/schedules`)
        .then(setSchedules)
        .catch(() => {})
      window.dispatchEvent(new CustomEvent('thread-updated'))
    })

    es.onopen = () => {
      // Reconnect resync: pub/sub is fire-and-forget — events published
      // while disconnected are lost. If no run is actually active, heal
      // the stuck-busy UI AND refetch — a run that completed during the
      // disconnect left its answer in the thread, never rendered.
      apiFetch<{ active: boolean }>(`/threads/${id}/run`)
        .then(({ active }) => {
          if (!active) {
            setBusy(false)
            refetchThread()
          }
        })
        .catch(() => {})
    }

    es.onerror = () => {
      // EventSource auto-reconnects — onopen resyncs state
    }

    return () => es.close()
  }, [id, refetchThread, removeLastUserMessage])

  const refetchSchedules = useCallback(() => {
    if (!id) return
    apiFetch<Schedule[]>(`/threads/${id}/schedules`)
      .then(setSchedules)
      .catch(() => {})
    window.dispatchEvent(new CustomEvent('thread-updated'))
  }, [id])

  const [showSchedules, setShowSchedules] = useState(false)

  const cancelSchedule = async (e: React.MouseEvent, scheduleId: string) => {
    e.stopPropagation()
    try {
      await apiFetch(`/schedules/${scheduleId}`, { method: 'DELETE' })
      setSchedules((prev) => prev.filter((s) => s.id !== scheduleId))
      window.dispatchEvent(new CustomEvent('thread-updated'))
    } catch {
      /* ignore */
    }
  }

  const enabledSchedules = schedules.filter((s) => s.enabled)

  // Scroll to bottom after loading thread history or on new committed message
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll after messages load or count changes
  useEffect(() => {
    if (pinnedRef.current) scrollToBottom()
  }, [messages, scrollToBottom])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  // Esc anywhere stops the in-flight generation
  useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  // Busy watchdog — the safety net for EVERY stuck-busy scenario (worker
  // death mid-run, stalled job reclaim, any event loss): while busy, poll
  // the authoritative run state; if no run is actually active, heal
  // (clear busy + refetch so a completed answer lands in the UI).
  useEffect(() => {
    if (!busy || !id) return
    const tick = setInterval(() => {
      apiFetch<{ active: boolean }>(`/threads/${id}/run`)
        .then(({ active }) => {
          if (active) return
          setBusy(false)
          refetchThread()
        })
        .catch(() => {})
    }, 15_000)
    return () => clearInterval(tick)
  }, [busy, id, refetchThread])

  // Stop = cancel the detached worker run → worker aborts + rewinds the
  // cancelled turn → 'cancelled' EventSource event cleans up the UI
  const stop = async () => {
    if (!id) return
    try {
      await apiFetch(`/threads/${id}/cancel`, { method: 'POST' })
    } catch {
      // no active run / race — UI is cleaned by stream events either way
    }
  }

  // Send = enqueue (202). All rendering happens via the EventSource
  // subscription (stream-start / thinking / tool / token / stream-done /
  // cancelled / error) — identical to the scheduled-run flow.
  const send = async () => {
    if (!id || !input.trim() || busy) return
    const content = input.trim()
    setInput('')
    setBusy(true)
    setError(null)
    setStreaming('')
    setStreamingThinking('')
    setStreamingToolCalls([])
    setStreamingToolResults([])

    // User just sent — always pin to bottom
    pinnedRef.current = true
    setShowJump(false)

    // Optimistically append user's message (removed again on 'cancelled')
    setMessages((prev) => [...prev, { role: 'user', content }])

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/threads/${id}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, deepResearch }),
      })
      if (res.status === 409) {
        throw new Error('A run is already in progress — stop it first.')
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // 202 — worker picked it up; EventSource drives the rest
    } catch (err) {
      // Enqueue failed — undo the optimistic message and reset
      setMessages(removeLastUserMessage)
      setError(err instanceof Error ? err.message : 'Send failed')
      setBusy(false)
    }
  }

  const hasActiveStream = streamingToolCalls.length > 0 || !!streamingThinking || !!streaming

  return (
    <div className="flex h-full flex-col">
      <header className="relative flex h-12 flex-none items-center justify-between border-b px-4">
        <span className="truncate text-sm font-medium">{meta?.title ?? 'Loading…'}</span>
        {enabledSchedules.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowSchedules((v) => !v)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Clock size={12} />
              <span>
                {enabledSchedules.length} scheduled · next in{' '}
                {formatCountdown(
                  enabledSchedules
                    .filter((s) => s.nextRun)
                    .map((s) => s.nextRun as string)
                    .sort()[0],
                )}
              </span>
            </button>
            {showSchedules && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowSchedules(false)}
                  onKeyDown={() => setShowSchedules(false)}
                  role="button"
                  tabIndex={0}
                  aria-label="Close schedules"
                />
                <div className="absolute right-4 top-11 z-20 w-80 rounded-lg border bg-background p-2 shadow-lg">
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    Scheduled tasks
                  </div>
                  {enabledSchedules.map((s) => (
                    <div
                      key={s.id}
                      className="group flex items-start gap-2 rounded-md px-2 py-2 text-xs hover:bg-accent"
                    >
                      <div className="mt-0.5 flex-none text-muted-foreground">
                        {s.type === 'recurring' ? <Repeat size={12} /> : <Timer size={12} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="truncate font-medium text-foreground">
                            {s.label || s.prompt.slice(0, 30)}
                          </span>
                          <span className="ml-2 flex-none text-[10px] text-muted-foreground">
                            {formatCountdown(s.nextRun)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {s.type === 'once' ? s.runAt?.slice(0, 16).replace('T', ' ') : s.cron}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => cancelSchedule(e, s.id)}
                        className="flex-none rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                        aria-label="Cancel schedule"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl">
          {messages.map((m, i) => (
            <MessageBubble
              key={`${m.role}-${i}`}
              sender={m.role}
              content={m.content}
              thinking={m.thinking}
            />
          ))}
          {hasActiveStream && (
            <MessageBubble
              sender="assistant"
              content={streaming}
              thinking={streamingThinking || undefined}
              thinkingStreaming={!!streamingThinking && !streaming}
              toolCalls={streamingToolCalls}
              toolResults={streamingToolResults}
              toolsStreaming={
                streamingToolCalls.length > 0 &&
                streamingToolResults.length < streamingToolCalls.length
              }
              subProgress={subProgress}
            />
          )}
          {/* Pending bubble — waiting for the first token (TTFT) */}
          {busy && !hasActiveStream && (
            <div className="cv-auto flex gap-3 px-4 py-3 sm:px-6">
              <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-muted text-foreground">
                <Bot size={15} />
              </div>
              <div className="flex items-center gap-1.5 pt-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          )}
          {error && <div className="px-6 py-4 text-sm text-red-500">{error}</div>}
        </div>

        {/* Jump-to-bottom button — appears when scrolled up during streaming */}
        {showJump && hasActiveStream && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="sticky bottom-4 left-full mr-4 flex h-9 w-9 items-center justify-center rounded-full border bg-background shadow-md transition-opacity hover:bg-accent"
            aria-label="Scroll to latest"
          >
            <ArrowDown size={16} />
          </button>
        )}
      </div>

      <footer className="flex-none border-t bg-background p-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              rows={1}
              placeholder="Message MiMo…  (Enter to send, Shift+Enter for newline)"
              className="max-h-48 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-80"
                aria-label="Stop generation (Esc)"
                title="Stop generation (Esc)"
              >
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!input.trim()}
                className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                aria-label="Send message"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={toggleDeepResearch}
              aria-pressed={deepResearch}
              title={
                deepResearch ? 'Deep Research ON — always used' : 'Deep Research OFF — never used'
              }
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                deepResearch
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Telescope size={12} />
              Deep Research {deepResearch ? 'on' : 'off'}
            </button>
            <p className="text-[11px] text-muted-foreground">
              MiMo can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

function formatCountdown(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ${secs % 60}s`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
