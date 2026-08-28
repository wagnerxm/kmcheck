/**
 * Utilitários de data/hora. Padronizados em pt-BR e no fuso horário de
 * São Paulo, já que é o público-alvo inicial da plataforma.
 */

const DEFAULT_LOCALE = "pt-BR";
const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/**
 * Formata uma data ISO em data e hora legíveis, ex.: "28/08/2026 às 19:00".
 */
export function formatDateTime(
  isoDate: string,
  options?: { timeZone?: string; locale?: string },
): string {
  const date = new Date(isoDate);
  const formatter = new Intl.DateTimeFormat(options?.locale ?? DEFAULT_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options?.timeZone ?? DEFAULT_TIME_ZONE,
  });
  return formatter.format(date).replace(",", " às");
}

/**
 * Retorna o tempo restante até o apito inicial em formato compacto e legível,
 * ex.: "em 2h 15min", "em 3 dias", "ao vivo" (quando já começou), ou
 * "encerrado" quando o horário já passou há mais de algumas horas — em geral
 * combine com o `status` real do evento para decidir isso com precisão.
 */
export function timeUntilKickoff(kickoffAt: string, now: Date = new Date()): string {
  const kickoff = new Date(kickoffAt);
  const diffMs = kickoff.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "ao vivo";
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays >= 1) {
    return diffDays === 1 ? "em 1 dia" : `em ${diffDays} dias`;
  }

  if (diffHours >= 1) {
    const remainingMinutes = diffMinutes % 60;
    return remainingMinutes > 0
      ? `em ${diffHours}h ${remainingMinutes}min`
      : `em ${diffHours}h`;
  }

  return `em ${diffMinutes}min`;
}

/** Indica se o instante atual é anterior ao apito inicial do evento. */
export function isBeforeKickoff(kickoffAt: string, now: Date = new Date()): boolean {
  return now.getTime() < new Date(kickoffAt).getTime();
}
