const baseUrl = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    let requestId: string | undefined
    try {
      const body = (await res.json()) as { error?: { message?: string; requestId?: string } }
      message = body.error?.message ?? message
      requestId = body.error?.requestId
    } catch {
      // swallow parse error
    }
    throw new ApiError(res.status, message, requestId)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
