import pg from 'pg'
import { env } from '../env.js'

const { Pool } = pg

export const pgPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const client = await pgPool.connect()
  try {
    // biome-ignore lint/suspicious/noExplicitAny: pg's query signature requires any[]
    return await client.query<T>(text, params as any[])
  } finally {
    client.release()
  }
}

export async function closePg(): Promise<void> {
  await pgPool.end()
}
