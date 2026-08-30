/**
 * Tipos internos para provedores de odds.
 *
 * Estes tipos representam os dados NORMALIZADOS — independentes do provedor
 * de origem. Cada provider implementa a transformação dos dados brutos da
 * API para esses tipos padronizados.
 */

/** Evento (jogo/partida) normalizado, pronto para inserção. */
export interface NormalizedEvent {
  /** ID externo no provedor (ex.: "sgo_123456"). */
  externalId: string;
  provider: string;
  /** Sport key padronizado (ex.: "football"). */
  sportKey: string;
  /** ID da liga no provedor. */
  leagueExternalId: string;
  leagueName: string;
  homeTeamName: string;
  homeTeamExternalId: string;
  awayTeamName: string;
  awayTeamExternalId: string;
  /** Horário do apito inicial (ISO 8601, UTC). */
  kickoffAt: string;
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
  homeScore?: number;
  awayScore?: number;
}

/** Odd normalizada de um provedor. */
export interface NormalizedOdds {
  /** ID externo do evento no provedor. */
  eventExternalId: string;
  /** Slug da casa de apostas no provedor (ex.: "bet365"). */
  bookmakerSlug: string;
  bookmakerName: string;
  /** Key do mercado padronizado (ex.: "moneyline", "totals_2.5"). */
  marketKey: string;
  /** Key do outcome padronizado (ex.: "home", "over"). */
  outcomeKey: string;
  /** Odds em formato decimal (> 1.0). */
  decimalOdds: number;
  /** Timestamp de quando a odd foi capturada na origem. */
  capturedAt: string;
}

/** Resultado de uma coleta de odds de um provedor. */
export interface OddsCollectionResult {
  provider: string;
  events: NormalizedEvent[];
  odds: NormalizedOdds[];
  /** Quantas requisições à API foram feitas nesta coleta. */
  apiCallsUsed: number;
  /** Erros não-fatais encontrados durante a coleta. */
  warnings: string[];
}

/** Interface que todo provedor de odds deve implementar. */
export interface OddsProvider {
  /** Nome identificador do provedor. */
  readonly name: string;

  /**
   * Coleta odds para eventos de futebol nos próximos N dias.
   *
   * @param options.sportKey - Sport (default: "football")
   * @param options.daysAhead - Dias à frente para buscar (default: 14)
   * @param options.leagueIds - Filtrar por IDs de liga (opcional)
   */
  collectOdds(options?: {
    sportKey?: string;
    daysAhead?: number;
    leagueIds?: string[];
  }): Promise<OddsCollectionResult>;

  /**
   * Coleta odds para um evento específico (usado para polling urgente).
   */
  collectEventOdds(eventExternalId: string): Promise<OddsCollectionResult>;

  /**
   * Verifica se o provedor está operacional.
   */
  healthCheck(): Promise<{ ok: boolean; message: string }>;
}
