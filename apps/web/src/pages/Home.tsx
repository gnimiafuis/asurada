import type { User } from '@asurada/shared'
import { useEffect, useState } from 'react'

export function HomePage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/users')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as User[]
      })
      .then(setUsers)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-3xl font-bold">Asurada</h1>
      <p className="mb-4 text-gray-600">Vite + React + Hono monorepo is up.</p>

      <h2 className="mb-3 text-xl font-semibold">Users</h2>
      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {!loading && !error && users.length === 0 && <p>No users yet.</p>}
      {!loading && !error && users.length > 0 && (
        <ul className="space-y-2">
          {users.map((u) => (
            <li key={u.id} className="rounded border p-3">
              <div className="font-medium">{u.name}</div>
              <div className="text-sm text-gray-500">{u.email}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
