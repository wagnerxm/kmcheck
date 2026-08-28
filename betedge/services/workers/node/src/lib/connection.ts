/**
 * Conexão Redis compartilhada, usada como backend das filas BullMQ.
 *
 * BullMQ recomenda uma conexão dedicada por Queue/Worker/QueueEvents em
 * cenários de alta concorrência, mas reaproveitar uma única instância
 * `IORedis` (com `maxRetriesPerRequest: null`, exigido pelo BullMQ) é
 * suficiente e mais simples para o volume de jobs desta fase do projeto.
 */
import IORedis from "ioredis";

import { config } from "../config.js";

export function createRedisConnection(): IORedis {
  return new IORedis(config.redisUrl, {
    // BullMQ exige que isso seja `null` — ele mesmo gerencia retries de
    // comandos bloqueantes (ex.: BRPOPLPUSH usado internamente pelas filas).
    maxRetriesPerRequest: null,
  });
}

export const sharedConnection = createRedisConnection();
