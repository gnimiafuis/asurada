import { tool } from '@langchain/core/tools'
import * as cheerio from 'cheerio'
import { z } from 'zod'

export function createDuckDuckGoTool() {
  return tool(
    async ({ query }) => {
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return `DuckDuckGo search failed: ${res.status}`
      const html = await res.text()
      const $ = cheerio.load(html)
      const results: string[] = []
      $('.result')
        .slice(0, 5)
        .each((_, el) => {
          const title = $(el).find('.result__title').text().trim()
          const snippet = $(el).find('.result__snippet').text().trim()
          const link = $(el).find('.result__a').attr('href') ?? ''
          // DDG wraps links in a redirect; extract the actual URL
          const url = link.startsWith('//duckduckgo.com/l/?uddg=')
            ? decodeURIComponent(link.replace('//duckduckgo.com/l/?uddg=', '').split('&')[0] ?? '')
            : link
          if (title) results.push(`- **${title}**\n  ${url}\n  ${snippet}`)
        })
      return results.length > 0
        ? `DuckDuckGo results:\n${results.join('\n\n')}`
        : 'No results found.'
    },
    {
      name: 'duckduckgo_search',
      description:
        'Search the web using DuckDuckGo (free, no API key needed). Good fallback for general queries. Returns titles, URLs, and snippets.',
      schema: z.object({
        query: z.string().describe('The search query'),
      }),
    },
  )
}
