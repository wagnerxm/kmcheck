/**
 * Provider: The Odds API (https://the-odds-api.com)
 *
 * Fonte secundária de odds — estrutura preparada conforme ARCHITECTURE.md.
 * A implementação completa será feita quando a integração for necessária.
 *
 * Diferenças relevantes em relação ao SportsGameOdds:
 * - Autenticação via query param `apiKey` (não header).
 * - Endpoint principal: GET /v4/sports/{sport}/odds
 * - Esporte futebol: sport = "soccer_*" (ex.: "soccer_brazil_serie_a").
 * - Odds vêm agrupadas por bookmaker, não por mercado.
 * - Rate limit baseado em "créditos" por requisição (depende dos parâmetros).
 *
 * Referência: https://the-odds-api.com/liveapi/guides/v4/
 */

import type { OddsProvider, OddsCollectionResult } from './types.js';

export class TheOddsApiProvider implements OddsProvider {
  readonly name = 'theoddsapi';

  async collectOdds(): Promise<OddsCollectionResult> {
    // TODO: Implementar quando a integração for ativada.
    // O mapeamento de mercados e outcomes seguirá o mesmo padrão
    // de normalização do SportsGameOddsProvider.
    return {
      provider: this.name,
      events: [],
      odds: [],
      apiCallsUsed: 0,
      warnings: ['Provider The Odds API ainda não implementado — use SportsGameOdds como primário.'],
    };
  }

  async collectEventOdds(): Promise<OddsCollectionResult> {
    return {
      provider: this.name,
      events: [],
      odds: [],
      apiCallsUsed: 0,
      warnings: ['Provider The Odds API ainda não implementado.'],
    };
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: false, message: 'The Odds API provider ainda não implementado.' };
  }
}
