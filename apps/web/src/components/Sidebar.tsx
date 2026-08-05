import type { Thread } from '@asurada/shared'
import { MessageSquarePlus, Pencil, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api.js'
import { ThemeToggle } from '../theme/ThemeToggle.js'

export function Sidebar() {
  const { id: activeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [threads, setThreads] = useState<Thread[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    apiFetch<Thread[]>('/threads')
      .then(setThreads)
      .catch(() => {
        /* keep stale list, do not crash the UI */
      })
      .finally(() => setLoading(false))
  }, [])

  // Fetch on mount and whenever the window regains focus (so newly sent
  // messages in another panel bubble the thread to the top).
  useEffect(() => {
    load()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // Reload when the active thread changes (e.g. a new thread was created
  // by navigating elsewhere).
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch only when activeId changes
  useEffect(() => {
    if (!activeId) return
    setThreads((prev) => {
      const found = prev.find((t) => t.id === activeId)
      if (!found) load()
      return prev
    })
  }, [activeId])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const thread = await apiFetch<Thread>('/threads', { method: 'POST', body: '{}' })
      setThreads((prev) => [thread, ...prev])
      navigate(`/threads/${thread.id}`)
    } catch {
      /* ignore */
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, threadId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm('Delete this thread?')) return
    try {
      await apiFetch(`/threads/${threadId}`, { method: 'DELETE' })
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
      if (threadId === activeId) navigate('/')
    } catch {
      /* ignore */
    }
  }

  // Focus the rename input when it opens
  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  const startRename = (e: React.MouseEvent, thread: Thread) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingId(thread.id)
    setDraftTitle(thread.title)
  }

  const commitRename = async () => {
    const id = editingId
    const title = draftTitle.trim()
    setEditingId(null)
    if (!id || !title) return
    const snapshot = threads
    // optimistic update
    setThreads((list) => list.map((t) => (t.id === id ? { ...t, title } : t)))
    try {
      await apiFetch(`/threads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
    } catch {
      // rollback on failure
      setThreads(snapshot)
    }
  }

  const cancelRename = () => setEditingId(null)

  const onRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
  }

  const filtered = query
    ? threads.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    : threads

  return (
    <aside className="flex h-full w-72 flex-none flex-col border-r bg-muted/30">
      <header className="flex items-center justify-between gap-2 p-3">
        <Link to="/" className="text-sm font-semibold tracking-tight">
          asurada
        </Link>
        <ThemeToggle />
      </header>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          <MessageSquarePlus size={16} />
          New thread
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads"
            className="w-full rounded-md border bg-background py-1.5 pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {loading && threads.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {query ? 'No matches.' : 'No threads yet.'}
          </p>
        )}

        <ul className="space-y-0.5">
          {filtered.map((t) => {
            const active = t.id === activeId
            const isEditing = editingId === t.id
            return (
              <li key={t.id}>
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={onRenameKeyDown}
                    onBlur={commitRename}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                ) : (
                  <Link
                    to={`/threads/${t.id}`}
                    className={`group flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    }`}
                  >
                    <span className="flex-1 truncate">{t.title || 'New chat'}</span>
                    <button
                      type="button"
                      onClick={(e) => startRename(e, t)}
                      aria-label="Rename thread"
                      className="flex-none opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, t.id)}
                      aria-label="Delete thread"
                      className="flex-none opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <footer className="border-t p-3 text-[11px] text-muted-foreground">
        Built with Hono + LangGraph
      </footer>
    </aside>
  )
}
