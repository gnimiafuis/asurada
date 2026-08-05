import type { Message } from '@asurada/shared'
import { ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MessageBubble } from '../components/MessageBubble.js'
import { apiFetch } from '../lib/api.js'

type ThreadMeta = { id: string; title: string }

export function ThreadChat() {
  const { id } = useParams<{ id: string }>()
  const [meta, setMeta] = useState<ThreadMeta | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset on thread switch
  useEffect(() => {
    if (!id) return
    setMeta(null)
    setMessages([])
    setError(null)
    apiFetch<ThreadMeta & { messages: Message[] }>(`/threads/${id}`)
      .then((t) => {
        setMeta({ id: t.id, title: t.title })
        setMessages(t.messages)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  // Auto-scroll on new message — but NOT on every token (perf).
  // During streaming, we scroll on `busy` transitions only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional scroll on count/busy change only
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length, busy])

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
      // Throttle scroll during streaming to once per animation frame
      let scrollPending = false
      const scrollNow = () => {
        scrollPending = false
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
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

          if (event === 'token' || event === 'assistant-start') {
            assistantText += (JSON.parse(data) as { text?: string }).text ?? ''
            setStreaming(assistantText)
            if (!scrollPending) {
              scrollPending = true
              requestAnimationFrame(scrollNow)
            }
          } else if (event === 'done') {
            setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }])
            setStreaming('')
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 flex-none items-center border-b px-4">
        <span className="truncate text-sm font-medium">{meta?.title ?? 'Loading…'}</span>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl">
          {messages.map((m, i) => (
            <MessageBubble key={`${m.role}-${i}`} sender={m.role} content={m.content} />
          ))}
          {streaming && <MessageBubble sender="assistant" content={streaming} />}
          {error && <div className="px-6 py-4 text-sm text-red-500">{error}</div>}
        </div>
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
