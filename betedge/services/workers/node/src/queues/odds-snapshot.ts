/**
 * Worker de Snapshot de Odds — coração do pipeline de ingestão.
 *
 * Responsabilidades:
 * 1. Buscar odds dos provedores configurados (SportsGameOdds como primário).
 * 2. Normalizar entidades (ligas, times, eventos) → IDs internos.
 * 3. Inserir odds novas em odds_history (append-only).
 * 4. O trigger fn_sync_odds_from_history cuida de atualizar o snapshot em odds.
 *
 * Arquitetura:
 * - Um job SCHEDULER roda a cada N minutos e enfileira jobs de COLETA.
 * - Cada job de COLETA faz uma varredura completa nos próximos jogos.
 * - Jobs URGENTES são enfileirados para jogos que começam em breve (intervalo menor).
 *
 * Fluxo de dados:
 * SportsGameOdds API → NormalizedOdds → EntityResolver (IDs internos) → odds_history INSERT
 *
 * IMPORTANTE: odds_history é append-only. Este worker NUNCA faz UPDATE ou DELETE
 * nessa tabela. O trigger do banco sincroniza odds (snapshot) automaticamente.
 */

import { Queue, Worker, type Job } from 'bullmq';
import { config } from '../lib/config.js';
import { getBullConnection } from '../lib/redis.js';
import { getSupabase } from '../lib/supabase.js';
import { jobLogger, logger } from '../lib/logger.js';
import { SportsGameOddsProvider } from '../providers/sportsgameodds.js';
import { EntityResolver } from '../normalize/entity-resolver.js';
import type { NormalizedOdds } from '../providers/types.js';

// =============================================================================
// Nomes de filas e tipos de jobs
// =============================================================================

export const QUEUE_NAME = 'odds-snapshot';

/** Tipos de jobs nesta fila. */
export type OddsJobName = 'collect-all' | 'collect-event' | 'schedule-next';

/** Payload de cada tipo de job. */
export interface OddsJobData {
  /** ID único do batch (para rastreabilidade em odds_history.batch_id). */
  batchId: string;
  /** Tipo de coleta. */
  type: OddsJobName;
  /** IDs de ligas para filtrar (opcional — sem filtro = todas). */
  leagueIds?: string[];
  /** ID externo do evento (só para collect-event). */
  eventExternalId?: string;
}

/** Resultado reportado ao concluir um job. */
export interface OddsJobResult {
  eventsProcessed: number;
  oddsInserted: number;
  oddsSkipped: number;
  errors: number;
  durationMs: number;
}

// =============================================================================
// Fila
// =============================================================================

export function createOddsQueue(): Queue<OddsJobData, OddsJobResult> {
  const conn = getBullConnection();
  return new Queue<OddsJobData, OddsJobResult>(QUEUE_NAME, {
    ...conn,
    defaultJobOptions: {
      attempts: config.workers.maxRetries,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    },
  });
}

// =============================================================================
// Worker
// =============================================================================

export function createOddsWorker(): Worker<OddsJobData, OddsJobResult> {
  const conn = getBullConnection();

  const worker = new Worker<OddsJobData, OddsJobResult>(
    QUEUE_NAME,
    async (job: Job<OddsJobData, OddsJobResult>) => {
      const log = jobLogger(QUEUE_NAME, job.id ?? 'unknown', {
        type: job.data.type,
        batchId: job.data.batchId,
      });

      switch (job.data.type) {
        case 'collect-all':
          return processCollectAll(job, log);
        case 'collect-event':
          return processCollectEvent(job, log);
        case 'schedule-next':
          return processScheduleNext(job, log);
        default:
          throw new Error(`Tipo de job desconhecido: ${(job.data as OddsJobData).type}`);
      }
    },
    {
      ...conn,
      concurrency: config.workers.concurrency,
      limiter: {
        max: config.sportsGameOdds.rateLimit,
        duration: 60_000, // rate limit por minuto
      },
    },
  );

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, type: job.data.type, result: job.returnvalue },
      'Job concluído com sucesso',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, type: job?.data.type, error: err.message, attempt: job?.attemptsMade },
      'Job falhou',
    );
  });

  return worker;
}

// =============================================================================
// Processadores de job
// =============================================================================

/**
 * COLLECT-ALL: Coleta odds de todos os jogos de futebol nos próximos N dias.
 *
 * Este é o job principal, rodado a cada 15 min (ou 5 min para jogos urgentes).
 * Fluxo:
 * 1. Chamar SportsGameOdds para buscar eventos + odds.
 * 2. Para cada evento: resolver liga, times, evento → IDs internos.
 * 3. Para cada odd: resolver bookmaker, mercado, outcome → IDs internos.
 * 4. Inserir em odds_history (batch insert, chunks de 500).
 */
async function processCollectAll(
  job: Job<OddsJobData, OddsJobResult>,
  log: ReturnType<typeof jobLogger>,
): Promise<OddsJobResult> {
  const startTime = Date.now();
  const db = getSupabase();
  const provider = new SportsGameOddsProvider();
  const resolver = new EntityResolver(db);

  let oddsInserted = 0;
  let oddsSkipped = 0;
  let errors = 0;

  try {
    // 1. Buscar ID do esporte futebol
    const sportId = await resolver.getFootballSportId();

    // 2. Coletar dados da API
    await job.updateProgress(10);
    const result = await provider.collectOdds({
      sportKey: 'football',
      daysAhead: config.polling.maxDaysAhead,
      leagueIds: job.data.leagueIds,
    });

    log.info(
      { events: result.events.length, odds: result.odds.length, apiCalls: result.apiCallsUsed },
      'Dados coletados da API',
    );

    if (result.warnings.length > 0) {
      log.warn({ warnings: result.warnings }, 'Avisos durante coleta');
    }

    // 3. Resolver entidades e preparar registros de odds_history
    await job.updateProgress(30);
    const oddsRecords: Array<{
      event_id: string;
      bookmaker_id: string;
      market_id: string;
      outcome_id: string;
      decimal_odds: number;
      implied_probability: number;
      previous_odds: number | null;
      odds_change: number | null;
      recorded_at: string;
      source: string;
      batch_id: string;
    }> = [];

    // Cache de eventExternalId → eventInternalId (já resolvido)
    const eventIdMap = new Map<string, string>();

    // 3a. Resolver todos os eventos primeiro
    for (const event of result.events) {
      try {
        const leagueId = await resolver.resolveLeague(
          provider.name,
          event.leagueExternalId,
          event.leagueName,
          sportId,
        );
        if (!leagueId) continue;

        const homeTeamId = await resolver.resolveTeam(
          provider.name,
          event.homeTeamExternalId,
          event.homeTeamName,
          sportId,
          leagueId,
        );
        if (!homeTeamId) continue;

        const awayTeamId = await resolver.resolveTeam(
          provider.name,
          event.awayTeamExternalId,
          event.awayTeamName,
          sportId,
          leagueId,
        );
        if (!awayTeamId) continue;

        const eventId = await resolver.resolveEvent(provider.name, event.externalId, {
          sportId,
          leagueId,
          homeTeamId,
          awayTeamId,
          kickoffAt: event.kickoffAt,
          status: event.status,
          homeScore: event.homeScore,
          awayScore: event.awayScore,
        });
        if (!eventId) continue;

        eventIdMap.set(event.externalId, eventId);
      } catch (err) {
        errors++;
        log.error(
          { eventExternalId: event.externalId, error: (err as Error).message },
          'Erro ao resolver evento',
        );
      }
    }

    await job.updateProgress(50);

    // 3b. Resolver odds e montar registros
    for (const odd of result.odds) {
      try {
        const eventId = eventIdMap.get(odd.eventExternalId);
        if (!eventId) {
          oddsSkipped++;
          continue;
        }

        const bookmakerId = await resolver.resolveBookmaker(odd.bookmakerSlug);
        if (!bookmakerId) {
          oddsSkipped++;
          continue;
        }

        const marketId = await resolver.resolveMarket(odd.marketKey);
        if (!marketId) {
          oddsSkipped++;
          continue;
        }

        const outcomeId = await resolver.resolveOutcome(marketId, odd.outcomeKey);
        if (!outcomeId) {
          oddsSkipped++;
          continue;
        }

        // Buscar odd anterior para calcular movimento
        const previousOdds = await getPreviousOdds(db, eventId, bookmakerId, marketId, outcomeId);

        // Só inserir se a odd realmente mudou (evitar duplicatas desnecessárias)
        if (previousOdds !== null && previousOdds === odd.decimalOdds) {
          oddsSkipped++;
          continue;
        }

        const impliedProbability = 1 / odd.decimalOdds;

        oddsRecords.push({
          event_id: eventId,
          bookmaker_id: bookmakerId,
          market_id: marketId,
          outcome_id: outcomeId,
          decimal_odds: odd.decimalOdds,
          implied_probability: parseFloat(impliedProbability.toFixed(6)),
          previous_odds: previousOdds,
          odds_change: previousOdds !== null ? parseFloat((odd.decimalOdds - previousOdds).toFixed(4)) : null,
          recorded_at: odd.capturedAt,
          source: provider.name,
          batch_id: job.data.batchId,
        });
      } catch (err) {
        errors++;
        oddsSkipped++;
      }
    }

    await job.updateProgress(75);

    // 4. Inserir em odds_history (chunks de 500 para evitar payloads enormes)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < oddsRecords.length; i += CHUNK_SIZE) {
      const chunk = oddsRecords.slice(i, i + CHUNK_SIZE);

      const { error } = await db.from('odds_history').insert(chunk);

      if (error) {
        log.error(
          { chunkIndex: i, chunkSize: chunk.length, error: error.message },
          'Erro ao inserir chunk em odds_history',
        );
        errors += chunk.length;
      } else {
        oddsInserted += chunk.length;
      }

      // Atualizar progresso proporcionalmente
      const progress = 75 + Math.round((i / oddsRecords.length) * 25);
      await job.updateProgress(Math.min(progress, 99));
    }

    await job.updateProgress(100);

    const duration = Date.now() - startTime;
    log.info(
      { oddsInserted, oddsSkipped, errors, durationMs: duration, cacheStats: resolver.getCacheStats() },
      'Coleta de odds finalizada',
    );

    return {
      eventsProcessed: eventIdMap.size,
      oddsInserted,
      oddsSkipped,
      errors,
      durationMs: duration,
    };
  } finally {
    // Limpar cache do resolver para o próximo ciclo
    resolver.clearCache();
  }
}

/**
 * COLLECT-EVENT: Coleta odds de um evento específico (polling urgente).
 *
 * Usado para jogos que começam em breve — intervalo de coleta menor
 * para capturar movimentos de linha de última hora.
 */
async function processCollectEvent(
  job: Job<OddsJobData, OddsJobResult>,
  log: ReturnType<typeof jobLogger>,
): Promise<OddsJobResult> {
  const startTime = Date.now();
  const eventExternalId = job.data.eventExternalId;

  if (!eventExternalId) {
    throw new Error('eventExternalId obrigatório para job collect-event');
  }

  const db = getSupabase();
  const provider = new SportsGameOddsProvider();
  const resolver = new EntityResolver(db);

  let oddsInserted = 0;
  let oddsSkipped = 0;
  let errors = 0;

  try {
    const sportId = await resolver.getFootballSportId();
    const result = await provider.collectEventOdds(eventExternalId);

    log.info({ odds: result.odds.length }, 'Odds coletadas para evento específico');

    // Resolver evento (deve já existir)
    const eventIdFromCache = await (async () => {
      const { data } = await db
        .from('events')
        .select('id')
        .contains('external_ids', { [provider.name]: eventExternalId })
        .maybeSingle();
      return data?.id ?? null;
    })();

    if (!eventIdFromCache) {
      // Evento não existe no banco — criar via coleta normal
      if (result.events.length > 0) {
        const ev = result.events[0];
        const leagueId = await resolver.resolveLeague(provider.name, ev.leagueExternalId, ev.leagueName, sportId);
        if (!leagueId) throw new Error(`Liga não resolvida: ${ev.leagueExternalId}`);

        const homeId = await resolver.resolveTeam(provider.name, ev.homeTeamExternalId, ev.homeTeamName, sportId, leagueId);
        const awayId = await resolver.resolveTeam(provider.name, ev.awayTeamExternalId, ev.awayTeamName, sportId, leagueId);
        if (!homeId || !awayId) throw new Error('Times não resolvidos');

        await resolver.resolveEvent(provider.name, ev.externalId, {
          sportId, leagueId, homeTeamId: homeId, awayTeamId: awayId,
          kickoffAt: ev.kickoffAt, status: ev.status,
          homeScore: ev.homeScore, awayScore: ev.awayScore,
        });
      }
    }

    // Processar odds (reutiliza lógica similar ao collect-all)
    for (const odd of result.odds) {
      try {
        const { data: event } = await db
          .from('events')
          .select('id')
          .contains('external_ids', { [provider.name]: odd.eventExternalId })
          .maybeSingle();

        if (!event) { oddsSkipped++; continue; }

        const bookmakerId = await resolver.resolveBookmaker(odd.bookmakerSlug);
        if (!bookmakerId) { oddsSkipped++; continue; }

        const marketId = await resolver.resolveMarket(odd.marketKey);
        if (!marketId) { oddsSkipped++; continue; }

        const outcomeId = await resolver.resolveOutcome(marketId, odd.outcomeKey);
        if (!outcomeId) { oddsSkipped++; continue; }

        const previousOdds = await getPreviousOdds(db, event.id, bookmakerId, marketId, outcomeId);
        if (previousOdds !== null && previousOdds === odd.decimalOdds) {
          oddsSkipped++;
          continue;
        }

        const impliedProbability = 1 / odd.decimalOdds;
        const { error } = await db.from('odds_history').insert({
          event_id: event.id,
          bookmaker_id: bookmakerId,
          market_id: marketId,
          outcome_id: outcomeId,
          decimal_odds: odd.decimalOdds,
          implied_probability: parseFloat(impliedProbability.toFixed(6)),
          previous_odds: previousOdds,
          odds_change: previousOdds !== null ? parseFloat((odd.decimalOdds - previousOdds).toFixed(4)) : null,
          recorded_at: odd.capturedAt,
          source: provider.name,
          batch_id: job.data.batchId,
        });

        if (error) { errors++; } else { oddsInserted++; }
      } catch {
        errors++;
        oddsSkipped++;
      }
    }

    return {
      eventsProcessed: 1,
      oddsInserted,
      oddsSkipped,
      errors,
      durationMs: Date.now() - startTime,
    };
  } finally {
    resolver.clearCache();
  }
}

/**
 * SCHEDULE-NEXT: Enfileira o próximo ciclo de coleta.
 *
 * Analisa os próximos jogos e decide o intervalo:
 * - Se há jogos começando em < 3h → intervalo urgente (5 min).
 * - Caso contrário → intervalo padrão (15 min).
 *
 * Também enfileira jobs individuais (collect-event) para jogos muito próximos.
 */
async function processScheduleNext(
  job: Job<OddsJobData, OddsJobResult>,
  log: ReturnType<typeof jobLogger>,
): Promise<OddsJobResult> {
  const startTime = Date.now();
  const db = getSupabase();
  const queue = createOddsQueue();

  const now = new Date();
  const urgentThreshold = new Date(now.getTime() + config.polling.urgentHoursBeforeKickoff * 60 * 60 * 1000);

  // Buscar eventos urgentes (começam em breve)
  const { data: urgentEvents } = await db
    .from('events')
    .select('id, external_ids, kickoff_at')
    .eq('status', 'scheduled')
    .gte('kickoff_at', now.toISOString())
    .lte('kickoff_at', urgentThreshold.toISOString())
    .order('kickoff_at', { ascending: true })
    .limit(20);

  const hasUrgentGames = (urgentEvents?.length ?? 0) > 0;
  const nextInterval = hasUrgentGames
    ? config.polling.urgentIntervalSeconds
    : config.polling.intervalSeconds;

  // Enfileirar coleta geral
  const batchId = crypto.randomUUID();
  await queue.add(
    'collect-all',
    { batchId, type: 'collect-all' },
    { delay: nextInterval * 1000, jobId: `collect-all-${batchId}` },
  );

  // Enfileirar coletas individuais para eventos urgentes (polling mais frequente)
  if (urgentEvents && urgentEvents.length > 0) {
    for (const event of urgentEvents) {
      const externalIds = event.external_ids as Record<string, string>;
      const externalId = externalIds?.sportsgameodds;
      if (!externalId) continue;

      await queue.add(
        'collect-event',
        {
          batchId: crypto.randomUUID(),
          type: 'collect-event',
          eventExternalId: externalId,
        },
        {
          delay: config.polling.urgentIntervalSeconds * 1000,
          jobId: `collect-event-${externalId}-${Date.now()}`,
        },
      );
    }

    log.info(
      { urgentEvents: urgentEvents.length, nextIntervalSeconds: nextInterval },
      'Eventos urgentes detectados — polling com intervalo reduzido',
    );
  }

  // Re-agendar o próprio scheduler
  await queue.add(
    'schedule-next',
    { batchId: crypto.randomUUID(), type: 'schedule-next' },
    {
      delay: nextInterval * 1000,
      jobId: `schedule-next-${Date.now() + nextInterval * 1000}`,
    },
  );

  log.info(
    { nextIntervalSeconds: nextInterval, urgentGames: hasUrgentGames },
    'Próximo ciclo agendado',
  );

  return {
    eventsProcessed: 0,
    oddsInserted: 0,
    oddsSkipped: 0,
    errors: 0,
    durationMs: Date.now() - startTime,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Busca a última odd registrada para um par (evento, casa, mercado, outcome).
 *
 * Usado para:
 * 1. Detectar se a odd mudou (evitar duplicatas desnecessárias).
 * 2. Calcular previous_odds e odds_change no novo registro.
 *
 * Consulta a tabela odds (snapshot) que é mantida pelo trigger,
 * evitando scan na odds_history (muito mais pesada).
 */
async function getPreviousOdds(
  db: ReturnType<typeof getSupabase>,
  eventId: string,
  bookmakerId: string,
  marketId: string,
  outcomeId: string,
): Promise<number | null> {
  const { data } = await db
    .from('odds')
    .select('decimal_odds')
    .eq('event_id', eventId)
    .eq('bookmaker_id', bookmakerId)
    .eq('market_id', marketId)
    .eq('outcome_id', outcomeId)
    .maybeSingle();

  return data?.decimal_odds ?? null;
}
