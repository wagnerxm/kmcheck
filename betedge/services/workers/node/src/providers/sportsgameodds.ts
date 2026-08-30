/**
 * Provider: SportsGameOdds (https://sportsgameodds.com)
 *
 * Cliente completo para a API v2 do SportsGameOdds. Busca eventos e odds
 * de futebol, normaliza para o formato interno e respeita rate limits.
 *
 * Autenticação: API key via header `x-api-key`.
 * Endpoints usados:
 *   GET /events      — lista eventos com odds embutidas
 *   GET /events/{id} — evento específico com odds detalhadas
 *
 * A API retorna odds agrupadas por sportsbook (casa de apostas) e mercado.
 * Este provider faz o "flatten" para pares (evento×casa×mercado×outcome)
 * normalizados.
 */

import { z } from 'zod';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';
import type {
  OddsProvider,
  OddsCollectionResult,
  NormalizedEvent,
  NormalizedOdds,
} from './types.js';

// =============================================================================
// Schemas Zod para validar resposta da API (defensivo contra mudanças de contrato)
// =============================================================================

/** Odd individual retornada pela API. */
const ApiOddSchema = z.object({
  sportsbook: z.string(),
  price: z.number(), // odds decimal
});

/** Outcome dentro de um mercado. */
const ApiOutcomeSchema = z.object({
  id: z.string(),
  label: z.string(),
  odds: z.array(ApiOddSchema).optional().default([]),
});

/** Mercado retornado pela API. */
const ApiMarketSchema = z.object({
  id: z.string(),
  name: z.string(),
  outcomes: z.array(ApiOutcomeSchema).optional().default([]),
});

/** Evento retornado pela API. */
const ApiEventSchema = z.object({
  id: z.string(),
  sport: z.string(),
  league: z.object({
    id: z.string(),
    name: z.string(),
  }),
  home: z.object({
    id: z.string(),
    name: z.string(),
  }),
  away: z.object({
    id: z.string(),
    name: z.string(),
  }),
  startTime: z.string(),
  status: z.string().optional().default('scheduled'),
  scores: z
    .object({
      home: z.number().optional(),
      away: z.number().optional(),
    })
    .optional(),
  markets: z.array(ApiMarketSchema).optional().default([]),
});

/** Resposta paginada da API. */
const ApiResponseSchema = z.object({
  data: z.array(ApiEventSchema).optional().default([]),
  meta: z
    .object({
      page: z.number().optional(),
      totalPages: z.number().optional(),
      total: z.number().optional(),
    })
    .optional(),
});

// =============================================================================
// Mapeamento de mercados: SportsGameOdds → chave interna
// =============================================================================

/**
 * Mapa de nomes/IDs de mercado da API → chave interna padronizada.
 *
 * A API do SportsGameOdds usa IDs e nomes que podem variar entre esportes.
 * Este mapa normaliza para as chaves definidas no nosso banco (tabela markets).
 */
const MARKET_KEY_MAP: Record<string, string> = {
  // Resultado final (1X2 / moneyline)
  moneyline: 'moneyline',
  '1x2': 'moneyline',
  match_result: 'moneyline',
  match_winner: 'moneyline',
  full_time_result: 'moneyline',

  // Over/Under (totals)
  'total_over_under_2.5': 'totals_2.5',
  'totals_2.5': 'totals_2.5',
  'over_under_2.5': 'totals_2.5',
  'total_over_under_1.5': 'totals_1.5',
  'totals_1.5': 'totals_1.5',
  'total_over_under_3.5': 'totals_3.5',
  'totals_3.5': 'totals_3.5',

  // Handicap asiático
  'spread_-0.5': 'spread_-0.5',
  'asian_handicap_-0.5': 'spread_-0.5',
  'spread_-1.5': 'spread_-1.5',
  'asian_handicap_-1.5': 'spread_-1.5',

  // Ambas marcam
  btts: 'btts',
  both_teams_to_score: 'btts',

  // Dupla chance
  double_chance: 'double_chance',

  // Empate anula aposta
  draw_no_bet: 'draw_no_bet',
};

/**
 * Mapa de nomes de outcome da API → chave interna.
 * Normaliza variações como "Home", "1", "Team 1" → "home".
 */
const OUTCOME_KEY_MAP: Record<string, string> = {
  home: 'home',
  '1': 'home',
  'team 1': 'home',
  draw: 'draw',
  x: 'draw',
  tie: 'draw',
  away: 'away',
  '2': 'away',
  'team 2': 'away',
  over: 'over',
  under: 'under',
  yes: 'yes',
  no: 'no',
  '1x': 'home_draw',
  '12': 'home_away',
  x2: 'draw_away',
};

/** Mapa de status da API → status interno. */
const STATUS_MAP: Record<string, NormalizedEvent['status']> = {
  scheduled: 'scheduled',
  pregame: 'scheduled',
  upcoming: 'scheduled',
  not_started: 'scheduled',
  live: 'live',
  in_progress: 'live',
  in_play: 'live',
  finished: 'finished',
  final: 'finished',
  ended: 'finished',
  completed: 'finished',
  postponed: 'postponed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  suspended: 'postponed',
};

// =============================================================================
// Implementação do provider
// =============================================================================

export class SportsGameOddsProvider implements OddsProvider {
  readonly name = 'sportsgameodds';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries = 3;

  constructor() {
    this.baseUrl = config.sportsGameOdds.baseUrl;
    this.apiKey = config.sportsGameOdds.apiKey;
    this.timeoutMs = config.sportsGameOdds.timeoutMs;
  }

  // ---------------------------------------------------------------------------
  // Métodos públicos (interface OddsProvider)
  // ---------------------------------------------------------------------------

  async collectOdds(options?: {
    sportKey?: string;
    daysAhead?: number;
    leagueIds?: string[];
  }): Promise<OddsCollectionResult> {
    const sport = options?.sportKey ?? 'football';
    const daysAhead = options?.daysAhead ?? config.polling.maxDaysAhead;
    const now = new Date();
    const until = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    const log = logger.child({ provider: this.name, sport, daysAhead });
    log.info('Iniciando coleta de odds');

    const events: NormalizedEvent[] = [];
    const odds: NormalizedOdds[] = [];
    const warnings: string[] = [];
    let apiCallsUsed = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        sport,
        startTimeFrom: now.toISOString(),
        startTimeTo: until.toISOString(),
        includeOdds: 'true',
        page: String(page),
        limit: '50',
      });

      // Filtrar por ligas específicas, se informado
      if (options?.leagueIds?.length) {
        params.set('leagueIds', options.leagueIds.join(','));
      }

      try {
        const raw = await this.fetchApi(`/events?${params.toString()}`);
        apiCallsUsed++;

        const parsed = ApiResponseSchema.safeParse(raw);
        if (!parsed.success) {
          warnings.push(`Resposta inválida na página ${page}: ${parsed.error.message}`);
          log.warn({ page, error: parsed.error.message }, 'Resposta da API com formato inesperado');
          break;
        }

        const apiEvents = parsed.data.data;
        if (apiEvents.length === 0) {
          hasMore = false;
          break;
        }

        for (const apiEvent of apiEvents) {
          try {
            const normEvent = this.normalizeEvent(apiEvent);
            events.push(normEvent);

            const normOdds = this.normalizeEventOdds(apiEvent);
            odds.push(...normOdds);
          } catch (err) {
            const msg = `Erro ao normalizar evento ${apiEvent.id}: ${(err as Error).message}`;
            warnings.push(msg);
            log.warn({ eventId: apiEvent.id, error: (err as Error).message }, 'Erro de normalização');
          }
        }

        // Paginação
        const totalPages = parsed.data.meta?.totalPages ?? 1;
        hasMore = page < totalPages;
        page++;
      } catch (err) {
        warnings.push(`Erro HTTP na página ${page}: ${(err as Error).message}`);
        log.error({ page, error: (err as Error).message }, 'Falha na requisição à API');
        break;
      }
    }

    log.info(
      { events: events.length, odds: odds.length, apiCallsUsed, warnings: warnings.length },
      'Coleta de odds concluída',
    );

    return { provider: this.name, events, odds, apiCallsUsed, warnings };
  }

  async collectEventOdds(eventExternalId: string): Promise<OddsCollectionResult> {
    const log = logger.child({ provider: this.name, eventId: eventExternalId });
    log.info('Coletando odds de evento específico');

    const warnings: string[] = [];
    const events: NormalizedEvent[] = [];
    const odds: NormalizedOdds[] = [];

    try {
      const raw = await this.fetchApi(`/events/${eventExternalId}?includeOdds=true`);
      const parsed = ApiEventSchema.safeParse(raw);

      if (!parsed.success) {
        return {
          provider: this.name,
          events: [],
          odds: [],
          apiCallsUsed: 1,
          warnings: [`Formato inesperado: ${parsed.error.message}`],
        };
      }

      events.push(this.normalizeEvent(parsed.data));
      odds.push(...this.normalizeEventOdds(parsed.data));
    } catch (err) {
      warnings.push(`Erro ao buscar evento ${eventExternalId}: ${(err as Error).message}`);
      log.error({ error: (err as Error).message }, 'Falha ao buscar evento');
    }

    return { provider: this.name, events, odds, apiCallsUsed: 1, warnings };
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      // Requisição leve: buscar 1 evento para verificar conectividade
      await this.fetchApi('/events?limit=1&sport=football');
      return { ok: true, message: 'SportsGameOdds API operacional' };
    } catch (err) {
      return { ok: false, message: `Falha: ${(err as Error).message}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Normalização
  // ---------------------------------------------------------------------------

  /** Converte evento da API para formato interno. */
  private normalizeEvent(apiEvent: z.infer<typeof ApiEventSchema>): NormalizedEvent {
    const rawStatus = (apiEvent.status ?? 'scheduled').toLowerCase();
    const status = STATUS_MAP[rawStatus] ?? 'scheduled';

    return {
      externalId: apiEvent.id,
      provider: this.name,
      sportKey: apiEvent.sport?.toLowerCase() ?? 'football',
      leagueExternalId: apiEvent.league.id,
      leagueName: apiEvent.league.name,
      homeTeamName: apiEvent.home.name,
      homeTeamExternalId: apiEvent.home.id,
      awayTeamName: apiEvent.away.name,
      awayTeamExternalId: apiEvent.away.id,
      kickoffAt: apiEvent.startTime,
      status,
      homeScore: apiEvent.scores?.home,
      awayScore: apiEvent.scores?.away,
    };
  }

  /**
   * Extrai e normaliza todas as odds de um evento.
   *
   * A API retorna: event → markets[] → outcomes[] → odds[]
   * Produzimos linhas planas: (evento, casa, mercado, outcome, odds decimal)
   */
  private normalizeEventOdds(apiEvent: z.infer<typeof ApiEventSchema>): NormalizedOdds[] {
    const result: NormalizedOdds[] = [];
    const now = new Date().toISOString();

    for (const market of apiEvent.markets) {
      // Tentar mapear o ID/nome do mercado para nossa chave interna
      const marketId = market.id?.toLowerCase()?.replace(/\s+/g, '_') ?? '';
      const marketName = market.name?.toLowerCase()?.replace(/\s+/g, '_') ?? '';
      const marketKey = MARKET_KEY_MAP[marketId] ?? MARKET_KEY_MAP[marketName];

      if (!marketKey) {
        // Mercado não mapeado — ignorar silenciosamente
        // (muitos mercados da API não são cobertos na v1: corners, cards, etc.)
        continue;
      }

      for (const outcome of market.outcomes) {
        // Mapear outcome
        const outcomeLabel = outcome.label?.toLowerCase()?.trim() ?? '';
        const outcomeId = outcome.id?.toLowerCase()?.trim() ?? '';
        const outcomeKey = OUTCOME_KEY_MAP[outcomeLabel] ?? OUTCOME_KEY_MAP[outcomeId];

        if (!outcomeKey) continue;

        for (const odd of outcome.odds) {
          // Odds decimal deve ser > 1.0 (sem exceção)
          if (odd.price <= 1.0) continue;

          // Slugificar o nome do sportsbook para matching com nossa tabela
          const bookmakerSlug = odd.sportsbook
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

          result.push({
            eventExternalId: apiEvent.id,
            bookmakerSlug,
            bookmakerName: odd.sportsbook,
            marketKey,
            outcomeKey,
            decimalOdds: odd.price,
            capturedAt: now,
          });
        }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------

  /**
   * Requisição à API com retry exponencial e rate limit.
   *
   * Retry em: 429 (rate limit), 5xx (erro do servidor), timeout.
   * Falha imediata em: 401 (API key inválida), 403, 404.
   */
  private async fetchApi(path: string, attempt = 1): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          Accept: 'application/json',
          'User-Agent': 'BetEdge/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        // Erros não-retryáveis
        if (response.status === 401) {
          throw new Error('API key inválida (401). Verifique SPORTSGAMEODDS_API_KEY.');
        }
        if (response.status === 403) {
          throw new Error(`Acesso negado (403) para ${path}. Verifique permissões do plano.`);
        }
        if (response.status === 404) {
          throw new Error(`Recurso não encontrado (404): ${path}`);
        }

        // Erros retryáveis
        if ((response.status === 429 || response.status >= 500) && attempt <= this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
          logger.warn(
            { status: response.status, attempt, backoffMs, path },
            'Retentando requisição após erro retryável',
          );
          await this.sleep(backoffMs);
          return this.fetchApi(path, attempt + 1);
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText} — ${path}`);
      }

      return await response.json();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        if (attempt <= this.maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
          logger.warn({ attempt, backoffMs, path }, 'Timeout — retentando');
          await this.sleep(backoffMs);
          return this.fetchApi(path, attempt + 1);
        }
        throw new Error(`Timeout após ${this.maxRetries} tentativas: ${path}`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
