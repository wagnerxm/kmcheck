/**
 * Fila de polling de odds — busca periodicamente as odds correntes de cada
 * provedor configurado (`OddsProvider`), normaliza e persiste.
 *
 * Este arquivo é um scaffold: a estrutura da fila/worker do BullMQ e o
 * formato do job estão definidos; a lógica de negócio real (chamar o
 * provedor, normalizar mercados/entidades, gravar no Supabase, disparar a
 * avaliação de alertas) entra na Fase 1.
 */
import { Queue, Worker, type Job } from "bullmq";

import { sharedConnection } from "../lib/connection.js";
import type { OddsProvider } from "../providers/OddsProvider.js";

export const ODDS_POLL_QUEUE_NAME = "odds-poll";

/** Payload de um job de polling: qual provedor e qual esporte/liga consultar. */
export interface OddsPollJobData {
  providerName: string;
  sportKey: string;
  /** Se true, também busca odds de fechamento de eventos recém-iniciados (para CLV). */
  includeClosingOdds?: boolean;
}

/** Resultado resumido de um job de polling, para telemetria/logs. */
export interface OddsPollJobResult {
  eventsProcessed: number;
  quotesUpserted: number;
  requestsUsed: number;
}

export const oddsPollQueue = new Queue<OddsPollJobData, OddsPollJobResult>(ODDS_POLL_QUEUE_NAME, {
  connection: sharedConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1_000 },
  },
});

/**
 * Enfileira um job recorrente de polling para um provedor/esporte, via o
 * scheduler de repetição do BullMQ (equivalente a um cron gerenciado pela fila).
 */
export async function scheduleOddsPolling(
  data: OddsPollJobData,
  everyMs: number,
): Promise<void> {
  await oddsPollQueue.add(`${data.providerName}:${data.sportKey}`, data, {
    repeat: { every: everyMs },
    jobId: `odds-poll:${data.providerName}:${data.sportKey}`,
  });
}

/**
 * Processa um job de polling de odds. Recebe o `providers` registrado
 * externamente (injeção simples de dependência) para não acoplar o worker a
 * uma implementação concreta de `OddsProvider`.
 *
 * TODO(fase 1):
 *   1. `providers[job.data.providerName].fetchUpcomingOdds(job.data.sportKey)`.
 *   2. Normalizar entidades/mercados via `src/normalize/*`.
 *   3. Upsert de eventos e cotações no Supabase.
 *   4. Enfileirar `alerts-evaluate` para os eventos cujas odds mudaram.
 */
async function processOddsPollJob(
  job: Job<OddsPollJobData, OddsPollJobResult>,
  providers: Record<string, OddsProvider>,
): Promise<OddsPollJobResult> {
  const provider = providers[job.data.providerName];
  if (!provider) {
    throw new Error(`Provedor de odds desconhecido: ${job.data.providerName}`);
  }
  throw new Error(
    `processOddsPollJob não implementado (provider=${provider.name}, sportKey=${job.data.sportKey}).`,
  );
}

/**
 * Cria o Worker BullMQ desta fila. Chamado a partir de `src/index.ts`, que é
 * quem monta o registro de `providers` disponíveis.
 */
export function createOddsPollWorker(providers: Record<string, OddsProvider>): Worker<OddsPollJobData, OddsPollJobResult> {
  return new Worker<OddsPollJobData, OddsPollJobResult>(
    ODDS_POLL_QUEUE_NAME,
    (job) => processOddsPollJob(job, providers),
    { connection: sharedConnection, concurrency: 5 },
  );
}
