import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'

type Env = { Variables: { requestId: string } }

export const requestId: MiddlewareHandler<Env> = async (c, next) => {
  const id = c.req.header('x-request-id') ?? randomUUID()
  c.set('requestId', id)
  c.header('x-request-id', id)
  await next()
}
