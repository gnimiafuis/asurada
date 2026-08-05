import { randomUUID } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import { HttpError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

type Env = { Variables: { requestId: string } }

function jsonError(c: Context, status: ContentfulStatusCode, payload: unknown) {
  return c.json({ error: payload }, status)
}

export const errorHandler: MiddlewareHandler<Env> = async (c, next) => {
  try {
    await next()
  } catch (err) {
    const requestId = c.get('requestId') ?? randomUUID()

    if (err instanceof ZodError) {
      return jsonError(c, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues: err.issues,
        requestId,
      })
    }

    if (err instanceof HttpError) {
      if (err.status >= 500) {
        logger.error({ err: err.message, requestId, code: err.code }, 'http error')
      }
      return jsonError(c, err.status as ContentfulStatusCode, {
        code: err.code ?? 'HTTP_ERROR',
        message: err.message,
        details: err.details,
        requestId,
      })
    }

    logger.error(
      { err: err instanceof Error ? err.message : String(err), requestId },
      'unhandled error',
    )
    return jsonError(c, 500, {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId,
    })
  }
}
