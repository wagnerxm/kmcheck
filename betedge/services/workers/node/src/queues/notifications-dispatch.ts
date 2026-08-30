/**
 * Fila de disparo de notificações — entrega o alerta disparado ao usuário
 * pelo(s) canal(is) configurado(s) (push, e-mail, webhook, etc.).
 *
 * Scaffold: estrutura de fila/worker e formato do job definidos; a
 * integração real com cada canal de entrega entra na Fase 1.
 */
import { Queue, Worker, type Job } from "bullmq";

import { getBullConnection } from "../lib/redis.js";

export const NOTIFICATIONS_DISPATCH_QUEUE_NAME = "notifications-dispatch";

export type NotificationChannel = "push" | "email" | "webhook";

/** Payload de um job de notificação: para quem, por qual canal, com qual conteúdo. */
export interface NotificationsDispatchJobData {
  userId: string;
  channel: NotificationChannel;
  alertId: string;
  title: string;
  body: string;
  /** Dados extras específicos do canal (ex.: URL de webhook, deep link do app). */
  metadata?: Record<string, unknown>;
}

export interface NotificationsDispatchJobResult {
  delivered: boolean;
  providerMessageId?: string;
}

export const notificationsDispatchQueue = new Queue<NotificationsDispatchJobData, NotificationsDispatchJobResult>(
  NOTIFICATIONS_DISPATCH_QUEUE_NAME,
  {
    ...getBullConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 2_000 },
    },
  },
);

export async function enqueueNotification(data: NotificationsDispatchJobData): Promise<void> {
  await notificationsDispatchQueue.add(data.channel, data);
}

/**
 * Processa um job de disparo de notificação, delegando ao provedor do canal
 * apropriado.
 *
 * TODO(fase 1): implementar os três canais:
 *   - "push": integração com provedor de push (ex.: FCM/APNs via serviço intermediário).
 *   - "email": integração com provedor transacional de e-mail (ex.: Resend/SendGrid).
 *   - "webhook": POST assinado (HMAC) para a URL configurada pelo usuário.
 */
async function processNotificationJob(
  job: Job<NotificationsDispatchJobData, NotificationsDispatchJobResult>,
): Promise<NotificationsDispatchJobResult> {
  throw new Error(
    `processNotificationJob não implementado (channel=${job.data.channel}, userId=${job.data.userId}).`,
  );
}

export function createNotificationsDispatchWorker(): Worker<
  NotificationsDispatchJobData,
  NotificationsDispatchJobResult
> {
  return new Worker<NotificationsDispatchJobData, NotificationsDispatchJobResult>(
    NOTIFICATIONS_DISPATCH_QUEUE_NAME,
    processNotificationJob,
    { ...getBullConnection(), concurrency: 20 },
  );
}
