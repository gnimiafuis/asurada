import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { fetchWithRetry, truncateResult } from './retry.js'

export function createTavilyTool(apiKey: string) {
  return tool(
    async ({ query }) => {
      const res = await fetchWithRetry('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          api_key: apiKey,
          max_results: 5,
          include_answer: true,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return `Tavily search failed: ${res.status}`
      const data = (await res.json()) as {
        answer?: string
        results?: Array<{ title: string; url: string; content: string }>
      }
      const results = (data.results ?? [])
        .map((r) => `- **${r.title}**\n  ${r.url}\n  ${r.content}`)
        .join('\n\n')
      return truncateResult(
        `${data.answer ? `Answer: ${data.answer}\n\n` : ''}Sources:\n${results}`,
      )
    },
    {
      name: 'tavily_search',
      description:
        'Search the web. Pick ONE search tool per query — only try a different one if this returned an error or nothing useful. Returns text chunks and an AI-generated answer.',
      schema: z.object({
        query: z.string().describe('The search query'),
      }),
    },
  )
}
