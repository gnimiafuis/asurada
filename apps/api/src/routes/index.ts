import { Hono } from 'hono'
import { health } from './health.js'
import { threads } from './threads.js'
import { users } from './users.js'

export const routes = new Hono()

routes.route('/', health)
routes.route('/', users)
routes.route('/', threads)
