/**
 * Normalização de mercados de apostas — traduz o vocabulário específico de
 * cada provedor (`providerMarketKey`, `outcomeName`, `line`) para o
 * vocabulário canônico interno do BetEdge, consumido pelo Motor Estatístico
 * (ver `MarketType` em `services/engine/app/api/predictions.py`).
 *
 * Exemplo do problema que este módulo resolve: o mercado de resultado final
 * pode aparecer como `"h2h"` (The Odds API), `"moneyline"` (outros
 * provedores) ou `"match_winner"` — todos devem mapear para o mesmo
 * `CanonicalMarket.MATCH_RESULT` interno, e da mesma forma para os nomes de
 * resultado (`"Home"`/`"1"`/`"home_team_name"` -> `"home"`).
 */

/** Mercados canônicos internos do BetEdge — deve espelhar `MarketType` no Motor Estatístico. */
export enum CanonicalMarket {
  MatchResult = "match_result",
  BothTeamsToScore = "btts",
  OverUnderGoals = "over_under_goals",
  AsianHandicap = "asian_handicap",
  CorrectScore = "correct_score",
  DoubleChance = "double_chance",
}

/** Resultados canônicos internos (o conjunto válido depende do mercado). */
export type CanonicalOutcome = "home" | "draw" | "away" | "over" | "under" | "yes" | "no" | string;

export interface NormalizedMarketKey {
  market: CanonicalMarket;
  outcome: CanonicalOutcome;
  /** Linha normalizada (ex.: 2.5 gols, ou o valor do handicap), quando aplicável. */
  line: number | null;
}

/**
 * Tabela de mapeamento `providerMarketKey` -> `CanonicalMarket`, por provedor.
 *
 * TODO(fase 1): popular com os valores reais observados em cada provedor
 * (`sportsgameodds`, `the-odds-api`) à medida que a integração avança —
 * mantida vazia neste scaffold para não codificar mapeamentos não
 * verificados contra a API real.
 */
const MARKET_KEY_MAP: Record<string, Record<string, CanonicalMarket>> = {
  sportsgameodds: {},
  "the-odds-api": {
    h2h: CanonicalMarket.MatchResult,
    totals: CanonicalMarket.OverUnderGoals,
    spreads: CanonicalMarket.AsianHandicap,
  },
};

/**
 * Normaliza uma chave de mercado + nome de resultado de um provedor
 * específico para o vocabulário canônico interno.
 *
 * Retorna `null` quando o mercado do provedor não tem mapeamento conhecido
 * — o chamador deve logar e pular a cotação em vez de inventar um mapeamento.
 */
export function normalizeMarket(
  provider: string,
  providerMarketKey: string,
  outcomeName: string,
  line: number | null,
): NormalizedMarketKey | null {
  const providerMap = MARKET_KEY_MAP[provider];
  const market = providerMap?.[providerMarketKey];
  if (!market) {
    return null;
  }

  const outcome = normalizeOutcomeName(market, outcomeName);
  return { market, outcome, line };
}

/**
 * Normaliza o nome de um resultado dentro de um mercado já identificado.
 *
 * TODO(fase 1): implementar as regras de normalização por mercado (ex.:
 * para `MatchResult`, mapear variações de "Home"/"1"/nome do time mandante
 * para `"home"`; para `OverUnderGoals`, mapear "Over"/"Mais de" para `"over"`).
 */
function normalizeOutcomeName(market: CanonicalMarket, outcomeName: string): CanonicalOutcome {
  throw new Error(`normalizeOutcomeName não implementado (market=${market}, outcomeName=${outcomeName}).`);
}
