import type { Message, Thread } from '@asurada/shared'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, apiFetch } from '../lib/api.js'

type ThreadDetail = Thread & { messages: Message[] }

export function ThreadChatPage() {
  const { id } = useParams<{ id: string }>()
  const [thread, setThread] = useState<ThreadDetail | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    apiFetch<ThreadDetail>(`/threads/${id}`)
      .then(setThread)
      .catch((err: Error) => setError(err instanceof ApiError ? err.message : err.message))
  }, [id])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on message count or streaming-text change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [thread?.messages.length, streamingText])

  const send = async () => {
    if (!id || !input.trim() || sending) return
    const content = input.trim()
    setInput('')
    setSending(true)
    setError(null)
    setStreamingText('')

    // Optimistically append the user message
    setThread((prev) =>
      prev ? { ...prev, messages: [...prev.messages, { role: 'user', content }] } : prev,
    )

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

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const evt of events) {
          const lines = evt.split('\n')
          const eventLine = lines
            .find((l) => l.startsWith('event:'))
            ?.slice(6)
            .trim()
          const dataLine = lines
            .find((l) => l.startsWith('data:'))
            ?.slice(5)
            .trim()
          if (!dataLine) continue

          if (eventLine === 'token' || eventLine === 'assistant-start') {
            const parsed = JSON.parse(dataLine) as { text?: string }
            assistantText += parsed.text ?? ''
            setStreamingText(assistantText)
          } else if (eventLine === 'done') {
            setThread((prev) =>
              prev
                ? {
                    ...prev,
                    messages: [
                      ...prev.messages,
                      { role: 'assistant', content: assistantText } as Message,
                    ],
                  }
                : prev,
            )
            setStreamingText('')
          } else if (eventLine === 'error') {
            const parsed = JSON.parse(dataLine) as { message?: string }
            throw new Error(parsed.message ?? 'Agent error')
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col p-4">
      <header className="mb-3 flex items-center justify-between border-b pb-3">
        <Link to="/threads" className="text-sm text-blue-600 underline">
          ← All threads
        </Link>
        <h1 className="font-medium">{thread?.title ?? 'Loading…'}</h1>
        <span className="w-20" />
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto">
        {thread?.messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className={`max-w-[80%] rounded-lg p-3 ${
              m.role === 'user'
                ? 'ml-auto bg-black text-white dark:bg-white dark:text-black'
                : 'bg-gray-100 dark:bg-gray-900'
            }`}
          >
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}
        {streamingText && (
          <div className="max-w-[80%] rounded-lg bg-gray-100 p-3 dark:bg-gray-900">
            <div className="whitespace-pre-wrap">{streamingText}</div>
          </div>
        )}
        {error && <p className="text-red-600">Error: {error}</p>}
      </div>

      <footer className="mt-3 border-t pt-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
            placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 resize-none rounded border p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !input.trim()}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </footer>
    </main>
  )
}
