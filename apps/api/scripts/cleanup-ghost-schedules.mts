/**
 * One-off maintenance script: removes BullMQ repeatable jobs that no longer
 * have a matching enabled schedule row in Postgres ("ghost" jobs that fire
 * forever and get skipped by the worker).
 *
 * Run: pnpm schedules:cleanup   (from repo root)
 */
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/app'
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')

const pool = new pg.Pool({ connectionString: databaseUrl })
const connection = new IORedis({
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  maxRetriesPerRequest: null,
})
const queue = new Queue('default', { connection })

const { rows } = await pool.query<{ id: string }>('SELECT id FROM schedules WHERE enabled = true')
const validIds = new Set(rows.map((r) => r.id))

const jobs = await queue.getRepeatableJobs()
let removed = 0
for (const job of jobs) {
  const m = /^schedule-(.+)$/.exec(job.name ?? '')
  if (!m) continue
  const scheduleId = m[1]
  if (!validIds.has(scheduleId)) {
    console.log(
      `removing ghost: ${job.name} (every=${job.every ?? null} pattern=${job.pattern ?? null})`,
    )
    await queue.removeRepeatableByKey(job.key)
    removed++
  }
}

const remaining = await queue.getRepeatableJobs()
console.log(`\nremoved ${removed} ghost job(s); ${remaining.length} repeatable job(s) remain:`)
for (const j of remaining) {
  console.log(`  - ${j.name} (every=${j.every ?? null} pattern=${j.pattern ?? null})`)
}

await queue.close()
connection.disconnect()
await pool.end()
