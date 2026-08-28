/**
 * Entry point dos workers Node.js do BetEdge.
 *
 * Inicializa todas as filas e workers BullMQ. Cada worker roda em seu
 * próprio "processor" dentro do mesmo processo Node — para scale-out
 * horizontal, basta rodar mais instâncias do mesmo container.
 *
 * O boot faz:
 * 1. Validar configuração (falha rápido se faltar env var).
 * 2. Verificar conectividade (Redis, Supabase, SportsGameOdds).
 * 3. Inicializar workers.
 * 4. Agendar o primeiro ciclo de coleta de odds.
 * 5. Registrar handlers de shutdown graceful.
 */

import { config } from './lib/config.js';
import { logger } from './lib/logger.js';
import { getRedis } from './lib/redis.js';
import { getSupabase } from './lib/supabase.js';
import { SportsGameOddsProvider } from './providers/sportsgameodds.js';
import {
  createOddsQueue,
  createOddsWorker,
  QUEUE_NAME,
  type OddsJobData,
} from './queues/odds-snapshot.js';

async function main() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  BetEdge Workers — Inicializando...');
  logger.info('═══════════════════════════════════════════════════');
  logger.info({ env: config.nodeEnv }, 'Ambiente');

  // ─────────────────────────────────────────────────────────────
  // 1. Verificar conectividade
  // ─────────────────────────────────────────────────────────────

  // Redis
  try {
    const redis = getRedis();
    await redis.ping();
    logger.info('✓ Redis conectado');
  } catch (err) {
    logger.fatal({ error: (err as Error).message }, '✗ Falha ao conectar no Redis');
    process.exit(1);
  }

  // Supabase
  try {
    const db = getSupabase();
    const { data, error } = await db.from('sports').select('id').limit(1);
    if (error) throw new Error(error.message);
    logger.info('✓ Supabase conectado');
  } catch (err) {
    logger.fatal({ error: (err as Error).message }, '✗ Falha ao conectar no Supabase');
    process.exit(1);
  }

  // SportsGameOdds API (health check não-fatal — pode estar indisponível temporariamente)
  try {
    const provider = new SportsGameOddsProvider();
    const health = await provider.healthCheck();
    if (health.ok) {
      logger.info('✓ SportsGameOdds API operacional');
    } else {
      logger.warn({ message: health.message }, '⚠ SportsGameOdds API indisponível (worker tentará novamente)');
    }
  } catch (err) {
    logger.warn({ error: (err as Error).message }, '⚠ Health check SportsGameOdds falhou (não-fatal)');
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Inicializar workers
  // ─────────────────────────────────────────────────────────────

  const oddsQueue = createOddsQueue();
  const oddsWorker = createOddsWorker();

  logger.info(
    { queue: QUEUE_NAME, concurrency: config.workers.concurrency },
    '✓ Worker de odds inicializado',
  );

  // ─────────────────────────────────────────────────────────────
  // 3. Agendar primeiro ciclo de coleta
  // ─────────────────────────────────────────────────────────────

  // Verificar se já existe um job de coleta agendado (evitar duplicatas no restart)
  const existingJobs = await oddsQueue.getDelayed();
  const hasScheduled = existingJobs.some(
    (j) => j.data.type === 'collect-all' || j.data.type === 'schedule-next',
  );

  if (!hasScheduled) {
    // Primeiro ciclo: coletar imediatamente
    const batchId = crypto.randomUUID();
    await oddsQueue.add(
      'collect-all',
      { batchId, type: 'collect-all' } satisfies OddsJobData,
      { jobId: `collect-all-boot-${batchId}` },
    );

    // Agendar o scheduler para o próximo ciclo
    await oddsQueue.add(
      'schedule-next',
      { batchId: crypto.randomUUID(), type: 'schedule-next' } satisfies OddsJobData,
      {
        delay: config.polling.intervalSeconds * 1000,
        jobId: `schedule-next-boot-${Date.now()}`,
      },
    );

    logger.info(
      { intervalSeconds: config.polling.intervalSeconds },
      '✓ Primeiro ciclo de coleta enfileirado (execução imediata)',
    );
  } else {
    logger.info('Ciclo de coleta já agendado — pulando re-agendamento');
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Shutdown graceful
  // ─────────────────────────────────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Sinal de encerramento recebido — desligando workers...');

    // Parar de aceitar novos jobs e esperar os atuais terminarem (timeout de 30s)
    await Promise.allSettled([
      oddsWorker.close(),
      oddsQueue.close(),
    ]);

    const redis = getRedis();
    redis.disconnect();

    logger.info('Workers encerrados com sucesso');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Capturar erros não tratados
  process.on('uncaughtException', (err) => {
    logger.fatal({ error: err.message, stack: err.stack }, 'Erro não capturado — encerrando');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Promise rejeitada sem handler');
  });

  logger.info('═══════════════════════════════════════════════════');
  logger.info('  BetEdge Workers — Prontos e aguardando jobs ✓');
  logger.info('═══════════════════════════════════════════════════');
}

main().catch((err) => {
  logger.fatal({ error: (err as Error).message }, 'Falha fatal na inicialização');
  process.exit(1);
});
