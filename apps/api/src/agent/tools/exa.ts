import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { fetchWithRetry } from './retry.js'

export function createExaTool(apiKey: string) {
  return tool(
    async ({ query }) => {
      const res = await fetchWithRetry('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          query,
          numResults: 5,
          contents: { text: { maxCharacters: 500 } },
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) return `Exa search failed: ${res.status}`
      const data = (await res.json()) as {
        results?: Array<{ title: string; url: string; text?: string }>
      }
      const results = (data.results ?? [])
        .map((r) => `- **${r.title}**\n  ${r.url}\n  ${r.text ?? ''}`)
        .join('\n\n')
      return `Exa results:\n${results}`
    },
    {
      name: 'exa_search',
      description:
        'Search the web using Exa (neural/semantic search). Best for research, finding similar content, academic papers, and deep-dive queries.',
      schema: z.object({
        query: z.string().describe('The search query'),
      }),
    },
  )
}
