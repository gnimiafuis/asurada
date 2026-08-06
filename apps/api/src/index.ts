import { serve } from '@hono/node-server'
import { getModelChain } from './agent/llm.js'
import { app } from './app.js'
import { env } from './env.js'
import { closeCheckpointer, setupCheckpointer } from './lib/checkpointer.js'
import { logger } from './lib/logger.js'
import { closePg } from './lib/postgres.js'
import { closeQueue, closeWorker, startWorker } from './lib/queue.js'
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

  if (env.NODE_ENV === 'development') {
    const chain = getModelChain()
    console.log('\n  ┌─ Agent ──────────────────────────────────────┐')
    chain.forEach((m, i) => {
      const tag = i === 0 ? 'primary' : 'fallback'
      console.log(`${`  │  ${i === 0 ? '★' : '↳'} ${m.provider}(${m.model}) [${tag}]`.padEnd(48)}│`)
    })
    console.log('  ├─ Tools ──────────────────────────────────────┤')
    for (const t of active) console.log(`${`  │  ✓ ${t}`.padEnd(48)}│`)
    for (const t of inactive) console.log(`${`  │  ✗ ${t} (no API key)`.padEnd(48)}│`)
    console.log('  └──────────────────────────────────────────────┘\n')
  }
}

async function main() {
  await connectRedis()

  // Pre-create LangGraph checkpoint tables (idempotent)
  setupCheckpointer().catch((err) => {
    logger.warn({ err: err.message }, 'checkpointer setup deferred — will retry on first request')
  })

  const isApi = env.ROLE === 'api' || env.ROLE === 'all'
  const isWorker = env.ROLE === 'worker' || env.ROLE === 'all'

  if (isWorker) {
    startWorker(logger)
    logger.info({ role: env.ROLE }, '📦 BullMQ worker started')
  }

  if (isApi) {
    logToolStatus()
    serve({ fetch: app.fetch, port: env.PORT }, ({ address }) => {
      logger.info(
        { address, port: env.PORT, env: env.NODE_ENV, role: env.ROLE },
        '🚀 server started',
      )
    })
  }

  if (env.ROLE === 'worker') {
    logger.info({ role: env.ROLE }, '📦 worker-only mode — no HTTP server')
  }
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'failed to start')
  process.exit(1)
})

async function shutdown(signal: string) {
  logger.info({ signal, role: env.ROLE }, 'shutting down...')

  // Force exit after 5s regardless of pending connections
  const forceExit = setTimeout(() => {
    logger.warn('shutdown timeout — force exiting')
    process.exit(1)
  }, 5000)

  try {
    await closeWorker()
    await closeQueue()
    await closeRedis()
    await closeCheckpointer()
    await closePg()
    clearTimeout(forceExit)
    logger.info('shutdown complete')
    process.exit(0)
  } catch (err) {
    clearTimeout(forceExit)
    logger.error({ err }, 'error during shutdown')
    process.exit(1)
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
