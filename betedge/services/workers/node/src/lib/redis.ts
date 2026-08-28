/**
 * Conexão Redis compartilhada pelos workers.
 *
 * BullMQ gerencia suas próprias conexões, mas precisamos de uma conexão
 * separada para operações avulsas (cache de mapeamento, pub/sub, etc.).
 */

import IORedis from 'ioredis';
import { config } from './config.js';

let _redis: IORedis | null = null;

export function getRedis(): IORedis {
  if (!_redis) {
    _redis = new IORedis(config.redis.url, {
      maxRetriesPerRequest: null, // exigido pelo BullMQ
      enableReadyCheck: false,
    });
  }
  return _redis;
}

/** Opções de conexão para BullMQ (Queue/Worker). */
export function getBullConnection() {
  return {
    connection: new IORedis(config.redis.url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }),
  };
}
