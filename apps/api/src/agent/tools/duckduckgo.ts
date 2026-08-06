import { tool } from '@langchain/core/tools'
import * as cheerio from 'cheerio'
import { z } from 'zod'
import { fetchWithRetry, truncateResult } from './retry.js'

export function createDuckDuckGoTool() {
  return tool(
    async ({ query }) => {
      // Primary: HTML scraping (full web results)
      let results = await scrapeHtml(query)

      // Fallback: Instant Answer JSON API (fewer results but stable)
      if (results.length === 0) {
        results = await instantAnswerApi(query)
      }

      if (results.length === 0) return 'No results found.'

      return truncateResult(`DuckDuckGo results:\n${results.join('\n\n')}`)
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

async function scrapeHtml(query: string): Promise<string[]> {
  try {
    const res = await fetchWithRetry(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) return []

    const html = await res.text()
    const $ = cheerio.load(html)
    const results: string[] = []

    // Primary selectors
    const resultEls = $('.result, .web-result, .results_links')

    resultEls.slice(0, 5).each((_, el) => {
      const $el = $(el)
      // Try multiple title selectors
      const title =
        $el.find('.result__title, .result__a, h2, .result-title').first().text().trim() ||
        $el.find('a').first().text().trim()
      // Try multiple snippet selectors
      const snippet =
        $el.find('.result__snippet, .result__snippet__text, .snippet').first().text().trim() ||
        $el.find('p, div').first().text().trim()
      // Try multiple link selectors
      const href = $el.find('.result__a, .result__url, a').first().attr('href') ?? ''
      const url = extractUrl(href)

      if (title) {
        results.push(`- **${title}**\n  ${url}\n  ${snippet.slice(0, 300)}`)
      }
    })

    return results
  } catch {
    return []
  }
}

async function instantAnswerApi(query: string): Promise<string[]> {
  try {
    const res = await fetchWithRetry(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return []

    const data = (await res.json()) as {
      AbstractText?: string
      AbstractURL?: string
      Heading?: string
      RelatedTopics?: Array<{
        Text?: string
        FirstURL?: string
      }>
    }

    const results: string[] = []

    if (data.AbstractText) {
      results.push(
        `- **${data.Heading ?? 'Abstract'}**\n  ${data.AbstractURL ?? ''}\n  ${data.AbstractText}`,
      )
    }

    for (const topic of data.RelatedTopics ?? []) {
      if (topic.Text && results.length < 5) {
        results.push(`- ${topic.Text}\n  ${topic.FirstURL ?? ''}`)
      }
    }

    return results
  } catch {
    return []
  }
}

/** Extract the real URL from DDG's redirect wrapper. */
function extractUrl(href: string): string {
  if (!href) return ''
  if (href.startsWith('//duckduckgo.com/l/?uddg=')) {
    try {
      return decodeURIComponent(href.replace('//duckduckgo.com/l/?uddg=', '').split('&')[0] ?? '')
    } catch {
      return href
    }
  }
  return href.startsWith('http') ? href : `https:${href}`
}
