import { tool } from '@langchain/core/tools'
import { z } from 'zod'

export function createFirecrawlTools(apiKey: string) {
  const search = tool(
    async ({ query }) => {
      const res = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, limit: 5 }),
      })
      if (!res.ok) return `Firecrawl search failed: ${res.status}`
      const data = (await res.json()) as {
        data?: Array<{ title?: string; url?: string; markdown?: string; description?: string }>
      }
      const results = (data.data ?? [])
        .map((r) => `- **${r.title ?? r.url}**\n  ${r.url}\n  ${r.description ?? r.markdown ?? ''}`)
        .join('\n\n')
      return `Firecrawl results:\n${results}`
    },
    {
      name: 'firecrawl_search',
      description:
        'Search the web and get clean markdown content from pages. Best when you need full page content, not just snippets.',
      schema: z.object({
        query: z.string().describe('The search query'),
      }),
    },
  )

  const scrape = tool(
    async ({ url }) => {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      })
      if (!res.ok) return `Firecrawl scrape failed: ${res.status}`
      const data = (await res.json()) as {
        data?: { markdown?: string; title?: string }
      }
      return data.data?.markdown ?? 'No content extracted'
    },
    {
      name: 'firecrawl_scrape',
      description:
        'Read a specific URL and return its content as clean markdown. Use this when you have a URL and need to read its full content.',
      schema: z.object({
        url: z.string().url().describe('The URL to scrape'),
      }),
    },
  )

  return [search, scrape]
}
