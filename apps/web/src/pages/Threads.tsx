import type { Thread } from '@asurada/shared'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiFetch } from '../lib/api.js'

export function ThreadsPage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () => {
    setLoading(true)
    apiFetch<Thread[]>('/threads')
      .then(setThreads)
      .catch((err: Error) => setError(err instanceof ApiError ? err.message : err.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const thread = await apiFetch<Thread>('/threads', { method: 'POST', body: '{}' })
      setThreads((prev) => [thread, ...prev])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this thread?')) return
    try {
      await apiFetch(`/threads/${id}`, { method: 'DELETE' })
      setThreads((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Threads</h1>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {creating ? 'Creating…' : '+ New thread'}
        </button>
      </div>

      <p className="mb-4 text-gray-600">
        <Link to="/" className="text-blue-600 underline">
          Home
        </Link>{' '}
        → Threads
      </p>

      {error && <p className="mb-4 text-red-600">Error: {error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && threads.length === 0 && <p className="text-gray-500">No threads yet.</p>}

      <ul className="space-y-2">
        {threads.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded border p-4 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            <Link to={`/threads/${t.id}`} className="flex-1">
              <div className="font-medium">{t.title}</div>
              <div className="text-xs text-gray-500">{new Date(t.updatedAt).toLocaleString()}</div>
            </Link>
            <button
              type="button"
              onClick={() => handleDelete(t.id)}
              className="ml-4 text-sm text-red-600 hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
