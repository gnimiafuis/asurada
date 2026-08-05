import pino from 'pino'
import { env } from '../env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['*.password', '*.token', '*.authorization', '*.secret'],
    censor: '[REDACTED]',
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
      : undefined,
})

export type Logger = typeof logger
