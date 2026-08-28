/**
 * Configuração centralizada dos workers.
 *
 * Todas as variáveis de ambiente são validadas no boot — se faltar uma
 * variável obrigatória o processo falha imediatamente com mensagem clara,
 * em vez de falhar silenciosamente no meio de um job.
 */

import 'dotenv/config';

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  return v;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  // --- Supabase ---
  supabase: {
    url: required('NEXT_PUBLIC_SUPABASE_URL'),
    /** Service role key — acesso total, sem RLS. Usado pelos workers. */
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  // --- Redis ---
  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  // --- SportsGameOdds ---
  sportsGameOdds: {
    apiKey: required('SPORTSGAMEODDS_API_KEY'),
    baseUrl: optional('SPORTSGAMEODDS_BASE_URL', 'https://api.sportsgameodds.com/v2'),
    /** Requisições por minuto — respeitar rate limit do plano contratado. */
    rateLimit: parseInt(optional('SPORTSGAMEODDS_RATE_LIMIT', '30'), 10),
    /** Timeout em milissegundos por requisição HTTP. */
    timeoutMs: parseInt(optional('SPORTSGAMEODDS_TIMEOUT_MS', '15000'), 10),
  },

  // --- Polling ---
  polling: {
    /** Intervalo padrão entre coletas de odds (segundos). */
    intervalSeconds: parseInt(optional('ODDS_POLL_INTERVAL_SECONDS', '900'), 10), // 15 min
    /** Intervalo reduzido para jogos que começam em breve (segundos). */
    urgentIntervalSeconds: parseInt(optional('ODDS_URGENT_INTERVAL_SECONDS', '300'), 10), // 5 min
    /** Horas antes do kickoff para considerar "urgente". */
    urgentHoursBeforeKickoff: parseInt(optional('ODDS_URGENT_HOURS', '3'), 10),
    /** Máximo de dias à frente para buscar eventos. */
    maxDaysAhead: parseInt(optional('ODDS_MAX_DAYS_AHEAD', '14'), 10),
  },

  // --- Workers ---
  workers: {
    /** Concorrência: quantos jobs simultâneos por worker. */
    concurrency: parseInt(optional('WORKER_CONCURRENCY', '3'), 10),
    /** Máximo de tentativas antes de descartar um job. */
    maxRetries: parseInt(optional('WORKER_MAX_RETRIES', '3'), 10),
  },

  // --- Geral ---
  nodeEnv: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') === 'development',
} as const;
