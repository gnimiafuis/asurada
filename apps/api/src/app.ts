import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { env } from './env.js'
import { errorHandler } from './middleware/error.js'
import { requestId } from './middleware/requestId.js'
import { routes } from './routes/index.js'

type AppEnv = { Variables: { requestId: string } }

export const app = new Hono<AppEnv>()

app.use('*', errorHandler)
app.use('*', requestId)
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposeHeaders: ['X-Request-Id'],
  }),
)

app.route('/', routes)

app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))
