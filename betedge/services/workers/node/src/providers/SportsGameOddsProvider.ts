/**
 * Provedor de odds via SportsGameOdds (https://sportsgameodds.com).
 *
 * Escolhido como provedor primário do BetEdge pela cobertura ampla de
 * mercados e casas de apostas. Este arquivo é um scaffold: a estrutura de
 * classe, assinaturas de método e mapeamento de configuração estão prontos;
 * a chamada HTTP real e o parsing da resposta entram na Fase 1.
 */
import type { OddsPollResult, OddsProvider, RawOddQuote } from "./OddsProvider.js";

export interface SportsGameOddsConfig {
  apiKey: string;
  /** Base URL da API — parametrizável para apontar a um mock em testes/staging. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.sportsgameodds.com/v2";

export class SportsGameOddsProvider implements OddsProvider {
  readonly name = "sportsgameodds";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: SportsGameOddsConfig) {
    if (!config.apiKey) {
      throw new Error("SportsGameOddsProvider requer uma apiKey configurada.");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async fetchUpcomingOdds(sportKey: string): Promise<OddsPollResult> {
    // TODO(fase 1): GET `${this.baseUrl}/events?sport=${sportKey}&odds=true`,
    // mapear a resposta para `RawEvent[]`/`RawOddQuote[]` (ver `OddsProvider.ts`),
    // e contabilizar `requestsUsed` a partir do header de rate limit da API.
    throw new Error(`SportsGameOddsProvider.fetchUpcomingOdds não implementado (sportKey=${sportKey}).`);
  }

  async fetchClosingOdds(providerEventId: string): Promise<RawOddQuote[]> {
    // TODO(fase 1): GET `${this.baseUrl}/events/${providerEventId}/odds?snapshot=closing`.
    throw new Error(
      `SportsGameOddsProvider.fetchClosingOdds não implementado (providerEventId=${providerEventId}).`,
    );
  }

  async listSupportedSports(): Promise<string[]> {
    // TODO(fase 1): GET `${this.baseUrl}/sports` e extrair as chaves de esporte.
    throw new Error("SportsGameOddsProvider.listSupportedSports não implementado.");
  }

  /** Monta os headers de autenticação padrão exigidos pela API do SportsGameOdds. */
  private buildAuthHeaders(): Record<string, string> {
    return {
      "X-Api-Key": this.apiKey,
      Accept: "application/json",
    };
  }
}
