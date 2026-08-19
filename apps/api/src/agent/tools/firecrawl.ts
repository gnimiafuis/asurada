import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { fetchWithRetry, truncateResult } from './retry.js'

export function createFirecrawlTools(apiKey: string) {
  const search = tool(
    async ({ query }) => {
      const res = await fetchWithRetry('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, limit: 5 }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return `Firecrawl search failed: ${res.status}`
      const data = (await res.json()) as {
        data?: Array<{ title?: string; url?: string; markdown?: string; description?: string }>
      }
      const results = (data.data ?? [])
        .map((r) => `- **${r.title ?? r.url}**\n  ${r.url}\n  ${r.description ?? r.markdown ?? ''}`)
        .join('\n\n')
      return truncateResult(`Firecrawl results:\n${results}`)
    },
    {
      name: 'firecrawl_search',
      description:
        'Search the web with full page content. Pick ONE search tool per query — only try a different one if this returned an error or nothing useful.',
      schema: z.object({
        query: z.string().describe('The search query'),
      }),
    },
  )

  const scrape = tool(
    async ({ url }) => {
      const res = await fetchWithRetry('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url, formats: ['markdown'] }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) return `Firecrawl scrape failed: ${res.status}`
      const data = (await res.json()) as {
        data?: { markdown?: string; title?: string }
      }
      return truncateResult(data.data?.markdown ?? 'No content extracted')
    },
    {
      name: 'firecrawl_scrape',
      description:
        'Read a specific URL and return its content as clean markdown. Use when you have a URL and need the full page content.',
      schema: z.object({
        url: z.string().url().describe('The URL to scrape'),
      }),
    },
  )

  return [search, scrape]
}
