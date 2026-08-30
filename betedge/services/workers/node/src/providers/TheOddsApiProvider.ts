/**
 * Provedor de odds via The Odds API (https://the-odds-api.com).
 *
 * Provedor SECUNDÁRIO/de contingência do BetEdge — mantido pronto na
 * arquitetura (mesma interface `OddsProvider`) para permitir failover ou
 * comparação cruzada de odds, mas não implementado nesta fase. Ativar este
 * provedor é uma questão de: (1) implementar os métodos abaixo e (2)
 * registrar uma instância dele em `src/queues/odds-poll.ts`.
 */
import type { OddsPollResult, OddsProvider, RawOddQuote } from "./OddsProvider.js";

export interface TheOddsApiConfig {
  apiKey: string;
  baseUrl?: string;
  /** Regiões de casas de apostas a consultar (ex.: "eu", "uk", "us", "au"). */
  regions?: string[];
}

const DEFAULT_BASE_URL = "https://api.the-odds-api.com/v4";
const DEFAULT_REGIONS = ["eu"];

export class TheOddsApiProvider implements OddsProvider {
  readonly name = "the-odds-api";

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly regions: string[];

  constructor(config: TheOddsApiConfig) {
    if (!config.apiKey) {
      throw new Error("TheOddsApiProvider requer uma apiKey configurada.");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.regions = config.regions ?? DEFAULT_REGIONS;
  }

  async fetchUpcomingOdds(sportKey: string): Promise<OddsPollResult> {
    // TODO: GET `${this.baseUrl}/sports/${sportKey}/odds?apiKey=...&regions=${this.regions.join(",")}`.
    // Não implementado nesta fase — provedor arquitetado, não ativado.
    throw new Error(`TheOddsApiProvider.fetchUpcomingOdds não implementado (sportKey=${sportKey}).`);
  }

  async fetchClosingOdds(providerEventId: string): Promise<RawOddQuote[]> {
    // The Odds API não expõe snapshots históricos de fechamento no plano
    // padrão — TODO: avaliar o endpoint de "historical odds" (plano pago)
    // antes de implementar isto de fato.
    throw new Error(
      `TheOddsApiProvider.fetchClosingOdds não implementado (providerEventId=${providerEventId}).`,
    );
  }

  async listSupportedSports(): Promise<string[]> {
    // TODO: GET `${this.baseUrl}/sports?apiKey=...`.
    throw new Error("TheOddsApiProvider.listSupportedSports não implementado.");
  }
}
