/**
 * Interface abstrata para provedores de dados de odds.
 *
 * O BetEdge consome odds de múltiplos provedores externos (SportsGameOdds,
 * The Odds API, e possivelmente outros no futuro). Cada provedor tem seu
 * próprio formato de resposta, nomenclatura de mercados e cadência de
 * atualização — esta interface define o contrato comum que o restante do
 * pipeline (normalização, persistência, avaliação de alertas) consome,
 * isolando o resto do sistema das particularidades de cada API externa.
 */

/** Uma única cotação (odd decimal) de um resultado, oferecida por uma casa de apostas. */
export interface RawOddQuote {
  /** ID do evento no sistema do PROVEDOR (não o ID interno do BetEdge — ver `normalize/map-entities`). */
  providerEventId: string;
  /** Nome/slug da casa de apostas, conforme reportado pelo provedor. */
  bookmaker: string;
  /** Identificador do mercado no vocabulário do PROVEDOR (ver `normalize/map-markets`). */
  providerMarketKey: string;
  /** Nome do resultado dentro do mercado (ex.: "home", "draw", "away", "over", "under"). */
  outcomeName: string;
  /** Linha do mercado, quando aplicável (ex.: 2.5 em "over/under 2.5 gols", ou o handicap). */
  line: number | null;
  /** Odds decimais (formato europeu). */
  decimalOdds: number;
  /** Timestamp (ISO 8601) de quando esta cotação foi observada pelo provedor. */
  observedAt: string;
}

/** Metadados de um evento esportivo conforme reportado pelo provedor. */
export interface RawEvent {
  providerEventId: string;
  sportKey: string;
  league: string;
  homeTeamName: string;
  awayTeamName: string;
  /** Horário programado de início (ISO 8601, UTC). */
  commenceTime: string;
}

/** Resultado de uma chamada de polling de odds a um provedor. */
export interface OddsPollResult {
  events: RawEvent[];
  quotes: RawOddQuote[];
  /** Quantas chamadas de API foram consumidas — útil para telemetria de rate limit. */
  requestsUsed: number;
}

/**
 * Contrato que todo provedor de odds concreto (`SportsGameOddsProvider`,
 * `TheOddsApiProvider`, ...) deve implementar.
 */
export interface OddsProvider {
  /** Nome curto e estável do provedor, usado em logs e como chave de configuração. */
  readonly name: string;

  /**
   * Busca eventos futuros de uma liga/esporte específico, junto com suas
   * odds correntes de todas as casas de apostas cobertas pelo provedor.
   */
  fetchUpcomingOdds(sportKey: string): Promise<OddsPollResult>;

  /**
   * Busca as odds de fechamento (closing odds) de um evento já iniciado ou
   * finalizado — usado para calcular Closing Line Value (ver `app.metrics.clv`
   * no Motor Estatístico).
   */
  fetchClosingOdds(providerEventId: string): Promise<RawOddQuote[]>;

  /** Lista os esportes/ligas suportados por este provedor, na nomenclatura dele. */
  listSupportedSports(): Promise<string[]>;
}
