import type { Message, Schedule } from '@asurada/shared'
import { ArrowDown, ArrowUp, Clock, Repeat, Timer, X } from 'lucide-react'
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

  const scrollRef = useRef<HTMLDivElement>(null)
  // Ref (not state) — avoids re-render on every scroll event
  const pinnedRef = useRef(true)
  // State — only toggles when pin status changes, to show the jump button
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    pinnedRef.current = true
    setShowJump(false)
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior })
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isPinned = distanceFromBottom < SCROLL_PIN_THRESHOLD
    pinnedRef.current = isPinned
    setShowJump((prev) => (prev === !isPinned ? prev : !isPinned))
  }, [])

  // Reset on thread switch — always start pinned
  useEffect(() => {
    if (!id) return
    setMeta(null)
    setMessages([])
    setError(null)
    pinnedRef.current = true
    setShowJump(false)
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

  // SSE: listen for real-time thread updates (scheduled task results)
  useEffect(() => {
    if (!id) return
    const baseUrl = import.meta.env.VITE_API_URL ?? ''
    const es = new EventSource(`${baseUrl}/threads/${id}/events`, { withCredentials: true })

    es.addEventListener('new-message', (e) => {
      const data = JSON.parse(e.data) as { role: string; content: string; thinking?: string }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.content, thinking: data.thinking },
      ])
      pinnedRef.current = true
      setShowJump(false)
    })

    es.addEventListener('thread-updated', () => {
      // Only refetch schedules (auto-delete, last_run changes)
      apiFetch<Schedule[]>(`/threads/${id}/schedules`)
        .then(setSchedules)
        .catch(() => {})
      window.dispatchEvent(new CustomEvent('thread-updated'))
    })

    es.onerror = () => {
      // EventSource auto-reconnects — no action needed
    }

    return () => es.close()
  }, [id])

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

    // Optimistically append user's message
    setMessages((prev) => [...prev, { role: 'user', content }])

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/threads/${id}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''
      let thinkingText = ''
      // Throttle scroll during streaming to once per animation frame
      let scrollPending = false
      const scrollNow = () => {
        scrollPending = false
        // Only scroll if the user hasn't scrolled away
        if (pinnedRef.current) {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
        }
      }

      const requestScroll = () => {
        if (!scrollPending) {
          scrollPending = true
          requestAnimationFrame(scrollNow)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames separated by blank lines
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const lines = frame.split('\n')
          const event = lines
            .find((l) => l.startsWith('event:'))
            ?.slice(6)
            .trim()
          const data = lines
            .find((l) => l.startsWith('data:'))
            ?.slice(5)
            .trim()
          if (!data) continue

          if (event === 'tool-call') {
            const parsed = JSON.parse(data) as { name: string; args?: string }
            setStreamingToolCalls((prev) => [...prev, { name: parsed.name, args: parsed.args }])
            requestScroll()
          } else if (event === 'tool-result') {
            const parsed = JSON.parse(data) as { name: string; content: string }
            setStreamingToolResults((prev) => [...prev, parsed])
            requestScroll()
          } else if (event === 'thinking-start' || event === 'thinking-token') {
            thinkingText += (JSON.parse(data) as { text?: string }).text ?? ''
            setStreamingThinking(thinkingText)
            requestScroll()
          } else if (event === 'token' || event === 'assistant-start') {
            assistantText += (JSON.parse(data) as { text?: string }).text ?? ''
            setStreaming(assistantText)
            requestScroll()
          } else if (event === 'done') {
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: assistantText,
                thinking: thinkingText || undefined,
              },
            ])
            setStreaming('')
            setStreamingThinking('')
            setStreamingToolCalls([])
            setStreamingToolResults([])
            // Refetch schedules — the agent may have created/deleted
            // schedules via tool calls during this response
            refetchSchedules()
          } else if (event === 'error') {
            throw new Error((JSON.parse(data) as { message?: string }).message ?? 'Agent error')
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
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
            />
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
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
              rows={1}
              placeholder="Message MiMo…  (Enter to send, Shift+Enter for newline)"
              className="max-h-48 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={send}
              disabled={busy || !input.trim()}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              aria-label="Send message"
            >
              <ArrowUp size={16} />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            MiMo can make mistakes. Verify important information.
          </p>
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
