/**
 * Fila de avaliação de alertas — checa, a cada atualização relevante de
 * odds/predições, se algum alerta configurado por um usuário deve disparar
 * (ex.: "me avise quando o edge score de um jogo do Flamengo passar de 70").
 *
 * Scaffold: estrutura de fila/worker e formato do job definidos; a lógica de
 * avaliação em si (consultar alertas ativos, comparar contra o novo estado,
 * decidir disparo) entra na Fase 1, junto ao schema de alertas do usuário.
 */
import { Queue, Worker, type Job } from "bullmq";

import { sharedConnection } from "../lib/connection.js";
import { notificationsDispatchQueue } from "./notifications-dispatch.js";

export const ALERTS_EVALUATE_QUEUE_NAME = "alerts-evaluate";

/** Payload de um job de avaliação: o que mudou e para qual evento/mercado. */
export interface AlertsEvaluateJobData {
  eventId: string;
  market: string;
  /** Motivo do disparo do job — o que gerou a necessidade de reavaliar alertas. */
  trigger: "odds_updated" | "prediction_updated" | "edge_score_updated";
}

export interface AlertsEvaluateJobResult {
  alertsEvaluated: number;
  alertsTriggered: number;
}

export const alertsEvaluateQueue = new Queue<AlertsEvaluateJobData, AlertsEvaluateJobResult>(
  ALERTS_EVALUATE_QUEUE_NAME,
  {
    connection: sharedConnection,
    defaultJobOptions: {
      attempts: 2,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1_000 },
    },
  },
);

export async function enqueueAlertsEvaluation(data: AlertsEvaluateJobData): Promise<void> {
  await alertsEvaluateQueue.add("evaluate", data);
}

/**
 * Processa um job de avaliação de alertas.
 *
 * TODO(fase 1):
 *   1. Buscar alertas ativos que casam com `eventId`/`market` (tabela `alerts`).
 *   2. Para cada alerta, comparar sua condição (ex.: `edge_score >= threshold`)
 *      contra o estado corrente (buscado do Motor Estatístico ou cache Redis).
 *   3. Para cada alerta cuja condição passou a ser satisfeita (e que ainda
 *      não foi notificado para este estado — evitar spam), enfileirar em
 *      `notifications-dispatch` via `notificationsDispatchQueue.add(...)`.
 */
async function processAlertsEvaluateJob(
  job: Job<AlertsEvaluateJobData, AlertsEvaluateJobResult>,
): Promise<AlertsEvaluateJobResult> {
  throw new Error(
    `processAlertsEvaluateJob não implementado (eventId=${job.data.eventId}, market=${job.data.market}, trigger=${job.data.trigger}).`,
  );
}

export function createAlertsEvaluateWorker(): Worker<AlertsEvaluateJobData, AlertsEvaluateJobResult> {
  return new Worker<AlertsEvaluateJobData, AlertsEvaluateJobResult>(
    ALERTS_EVALUATE_QUEUE_NAME,
    processAlertsEvaluateJob,
    { connection: sharedConnection, concurrency: 10 },
  );
}
