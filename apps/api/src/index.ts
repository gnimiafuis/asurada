import { serve } from '@hono/node-server'
import { buildTools } from './agent/tools/index.js'
import { app } from './app.js'
import { env } from './env.js'
import { closeCheckpointer, setupCheckpointer } from './lib/checkpointer.js'
import { logger } from './lib/logger.js'
import { closePg } from './lib/postgres.js'
import { closeQueue, startWorker } from './lib/queue.js'
import { closeRedis, connectRedis } from './lib/redis.js'

function logToolStatus() {
  const active: string[] = []
  const inactive: string[] = []

  if (env.TAVILY_API_KEY) active.push('tavily_search')
  else inactive.push('tavily_search')

  if (env.EXA_API_KEY) active.push('exa_search')
  else inactive.push('exa_search')

  if (env.FIRECRAWL_API_KEY) {
    active.push('firecrawl_search', 'firecrawl_scrape')
  } else {
    inactive.push('firecrawl_search', 'firecrawl_scrape')
  }

  // DuckDuckGo is always active
  active.push('duckduckgo_search')

  logger.info(
    {
      provider: env.LLM_PROVIDER,
      model: env.LLM_MODEL ?? '(provider default)',
      activeTools: active,
      inactiveTools: inactive,
    },
    '🔧 agent tools status',
  )

  // Pretty-print to console for dev visibility
  if (env.NODE_ENV === 'development') {
    console.log('\n  ┌─ Agent Tools ──────────────────────────────┐')
    console.log(`${`  │ LLM: ${env.LLM_PROVIDER} (${env.LLM_MODEL ?? 'default'})`.padEnd(47)}│`)
    for (const t of active) console.log(`${`  │  ✓ ${t}`.padEnd(47)}│`)
    for (const t of inactive) console.log(`${`  │  ✗ ${t} (no API key)`.padEnd(47)}│`)
    console.log('  └────────────────────────────────────────────┘\n')
  }
}

async function main() {
  await connectRedis()
  // Pre-create LangGraph checkpoint tables (idempotent)
  setupCheckpointer().catch((err) => {
    logger.warn({ err: err.message }, 'checkpointer setup deferred — will retry on first request')
  })
  startWorker(logger)

  // Show which tools are active based on env keys
  logToolStatus()

  serve({ fetch: app.fetch, port: env.PORT }, ({ address }) => {
    logger.info({ address, port: env.PORT, env: env.NODE_ENV }, '🚀 server started')
  })
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'failed to start server')
  process.exit(1)
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down...')
  try {
    await closeQueue()
    await closeRedis()
    await closeCheckpointer()
    await closePg()
    logger.info('shutdown complete')
    process.exit(0)
  } catch (err) {
    logger.error({ err }, 'error during shutdown')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
