import { serve } from '@hono/node-server'
import { app } from './app.js'
import { env } from './env.js'
import { closeCheckpointer, setupCheckpointer } from './lib/checkpointer.js'
import { logger } from './lib/logger.js'
import { closePg } from './lib/postgres.js'
import { closeQueue, startWorker } from './lib/queue.js'
import { closeRedis, connectRedis } from './lib/redis.js'

async function main() {
  await connectRedis()
  // Pre-create LangGraph checkpoint tables (idempotent)
  setupCheckpointer().catch((err) => {
    logger.warn({ err: err.message }, 'checkpointer setup deferred — will retry on first request')
  })
  startWorker(logger)

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
