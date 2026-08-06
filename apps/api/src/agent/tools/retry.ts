/**
 * Fetch with automatic retry on transient failures (network errors + 5xx).
 * Does NOT retry on: 4xx (client errors), AbortError (timeouts).
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  opts: { retries?: number; baseDelay?: number } = {},
): Promise<Response> {
  const { retries = 2, baseDelay = 500 } = opts

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init)

      // 4xx → don't retry, return immediately
      if (res.status >= 400 && res.status < 500) return res

      // 5xx → retry if attempts remain
      if (res.status >= 500 && attempt < retries) {
        await sleep(baseDelay * 2 ** attempt)
        continue
      }

      return res
    } catch (err) {
      // AbortError (timeout) → don't retry
      if (err instanceof Error && err.name === 'AbortError') throw err
      // Last attempt → throw
      if (attempt === retries) throw err
      // Transient network error → retry with backoff
      await sleep(baseDelay * 2 ** attempt)
    }
  }

  // Unreachable — loop always returns or throws
  throw new Error('fetchWithRetry: unreachable')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Truncate tool output to prevent oversized results from consuming
 *  the LLM's context window. Applied to every tool's return value. */
export function truncateResult(text: string, max = 4000): string {
  return text.length > max
    ? `${text.slice(0, max)}\n\n...(result truncated, ${text.length - max} chars omitted)`
    : text
}

/**
 * Per-thread query deduplication. Prevents the LLM from calling the same
 * search tool with the same query multiple times in one conversation.
 */
export function createQueryDedup() {
  const cache = new Map<string, Set<string>>()

  return function isDuplicate(threadId: string | undefined, query: string): boolean {
    const key = threadId ?? '_global'
    let queries = cache.get(key)
    if (!queries) {
      queries = new Set()
      cache.set(key, queries)
    }
    const normalized = query.toLowerCase().trim()
    if (queries.has(normalized)) return true
    queries.add(normalized)
    return false
  }
}
