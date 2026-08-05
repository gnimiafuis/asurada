import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { env } from '../env.js'

let checkpointer: PostgresSaver | null = null
let setupPromise: Promise<void> | null = null

export function getCheckpointer(): PostgresSaver {
  if (!checkpointer) {
    checkpointer = PostgresSaver.fromConnString(env.DATABASE_URL)
  }
  return checkpointer
}

/**
 * Idempotently create the LangGraph checkpoint tables.
 * Safe to call multiple times.
 */
export function setupCheckpointer(): Promise<void> {
  if (!setupPromise) {
    setupPromise = getCheckpointer().setup()
  }
  return setupPromise
}

export async function closeCheckpointer(): Promise<void> {
  // PostgresSaver doesn't own the connection pool it's given via fromConnString,
  // but it does hold a pool internally. Close it on shutdown.
  if (checkpointer) {
    // @ts-expect-error — pool is not in the public type but exists on the instance
    const pool = checkpointer.pool
    if (pool && typeof pool.end === 'function') {
      await pool.end()
    }
    checkpointer = null
    setupPromise = null
  }
}
