/**
 * Logger estruturado para workers.
 *
 * Usa pino para logs JSON em produção e pino-pretty em dev.
 * Cada job pode criar um child logger com contexto (jobId, eventId, etc.).
 */

import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.isDev ? 'debug' : 'info',
  transport: config.isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  base: { service: 'betedge-workers' },
});

/** Cria child logger com contexto de job para rastreabilidade. */
export function jobLogger(jobName: string, jobId: string, extra?: Record<string, unknown>) {
  return logger.child({ job: jobName, jobId, ...extra });
}
