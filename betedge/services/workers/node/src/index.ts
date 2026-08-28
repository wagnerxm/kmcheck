/**
 * Ponto de entrada dos workers Node do BetEdge.
 *
 * Responsável por: instanciar os provedores de odds configurados, subir os
 * Workers do BullMQ (um por fila) e agendar os jobs recorrentes de polling.
 * Roda como processo de longa duração (um container dedicado), separado do
 * Motor Estatístico (Python/FastAPI) e dos workers Python (Celery).
 */
import { config } from "./config.js";
import { sharedConnection } from "./lib/connection.js";
import { createAlertsEvaluateWorker } from "./queues/alerts-evaluate.js";
import { createNotificationsDispatchWorker } from "./queues/notifications-dispatch.js";
import { createOddsPollWorker, scheduleOddsPolling } from "./queues/odds-poll.js";
import { SportsGameOddsProvider } from "./providers/SportsGameOddsProvider.js";
import type { OddsProvider } from "./providers/OddsProvider.js";

// Esportes/ligas cobertos no lançamento — expandir conforme o roadmap de
// coberturas do BetEdge avança para além do futebol.
const TRACKED_SPORTS = ["soccer_brazil_campeonato", "soccer_epl", "soccer_uefa_champs_league"];

function buildProviders(): Record<string, OddsProvider> {
  const providers: Record<string, OddsProvider> = {};

  if (config.sportsGameOddsApiKey) {
    providers.sportsgameodds = new SportsGameOddsProvider({ apiKey: config.sportsGameOddsApiKey });
  } else {
    console.warn("SPORTS_GAME_ODDS_API_KEY ausente — provedor SportsGameOdds não será ativado.");
  }

  // TheOddsApiProvider fica disponível na arquitetura mas não é ativado por
  // padrão nesta fase (ver `src/providers/TheOddsApiProvider.ts`).

  return providers;
}

async function main(): Promise<void> {
  console.log("Iniciando workers Node do BetEdge...");

  const providers = buildProviders();

  const oddsPollWorker = createOddsPollWorker(providers);
  const alertsEvaluateWorker = createAlertsEvaluateWorker();
  const notificationsDispatchWorker = createNotificationsDispatchWorker();

  const workers = [oddsPollWorker, alertsEvaluateWorker, notificationsDispatchWorker];

  for (const worker of workers) {
    worker.on("failed", (job, error) => {
      console.error(`[${worker.name}] job ${job?.id} falhou:`, error);
    });
    worker.on("error", (error) => {
      console.error(`[${worker.name}] erro no worker:`, error);
    });
  }

  // Agenda o polling recorrente para cada combinação provedor/esporte
  // rastreada. Idempotente: `jobId` fixo evita duplicar o agendamento em
  // reinícios do processo.
  for (const providerName of Object.keys(providers)) {
    for (const sportKey of TRACKED_SPORTS) {
      await scheduleOddsPolling({ providerName, sportKey }, config.oddsPollIntervalMs);
    }
  }

  console.log(`Workers no ar. Filas ativas: ${workers.map((w) => w.name).join(", ")}.`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Recebido ${signal}, encerrando workers com segurança...`);
    await Promise.all(workers.map((w) => w.close()));
    await sharedConnection.quit();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("Falha fatal ao iniciar os workers Node:", error);
  process.exit(1);
});
