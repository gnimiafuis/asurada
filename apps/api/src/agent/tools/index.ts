import type { StructuredToolInterface } from '@langchain/core/tools'
import { logger } from '../../lib/logger.js'
import { createDuckDuckGoTool } from './duckduckgo.js'
import { createExaTool } from './exa.js'
import { createFirecrawlTools } from './firecrawl.js'
import { createScheduleTools } from './schedule.js'
import { createTavilyTool } from './tavily.js'

/**
 * Build the tool list based on which API keys are present in the environment.
 *
 * Always available (no key needed):
 * - duckduckgo_search — free web search
 * - create_schedule, list_schedules, delete_schedule — task scheduling
 *
 * Conditional (need API keys):
 * - tavily_search, exa_search, firecrawl_search, firecrawl_scrape
 */
export function buildTools(env: {
  TAVILY_API_KEY?: string
  EXA_API_KEY?: string
  FIRECRAWL_API_KEY?: string
}): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = []

  // Always available — free, no key
  tools.push(createDuckDuckGoTool())

  // Schedule tools — always available
  tools.push(...createScheduleTools())
  logger.info('tools registered: delay_task, list_schedules, delete_schedule')

  if (env.TAVILY_API_KEY) {
    tools.push(createTavilyTool(env.TAVILY_API_KEY))
    logger.info('tool registered: tavily_search')
  }

  if (env.EXA_API_KEY) {
    tools.push(createExaTool(env.EXA_API_KEY))
    logger.info('tool registered: exa_search')
  }

  if (env.FIRECRAWL_API_KEY) {
    tools.push(...createFirecrawlTools(env.FIRECRAWL_API_KEY))
    logger.info('tools registered: firecrawl_search, firecrawl_scrape')
  }

  logger.info({ count: tools.length, names: tools.map((t) => t.name) }, 'agent tools ready')
  return tools
}
