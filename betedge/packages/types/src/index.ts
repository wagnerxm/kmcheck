/**
 * Tipos compartilhados do BetEdge — usados pelo frontend (apps/web), pelo
 * motor estatístico e pelos workers de ingestão de dados.
 *
 * Convenção: identificadores (`id`) são sempre `string` (UUID no Postgres/Supabase
 * ou o id externo do provedor de odds, prefixado quando necessário).
 */

// ============================================================================
// Esportes, campeonatos e temporadas
// ============================================================================

/** Código do esporte suportado pela plataforma. */
export type SportKey =
  | "soccer"
  | "basketball"
  | "tennis"
  | "american_football"
  | "baseball"
  | "hockey"
  | "mma"
  | "volleyball";

/** Campeonato/liga (ex.: Brasileirão Série A, NBA, Premier League). */
export interface League {
  id: string;
  sport: SportKey;
  name: string;
  /** Nome curto/sigla, ex.: "BSA", "NBA". */
  shortName: string;
  country: string;
  /** URL do escudo/logo da liga. */
  logoUrl?: string;
  /** Nível de competição — usado para priorizar cobertura (1 = principal). */
  tier: number;
}

/** Temporada de um campeonato. */
export interface Season {
  id: string;
  leagueId: string;
  /** Ex.: "2025", "2025/2026". */
  label: string;
  startDate: string; // ISO 8601
  endDate: string; // ISO 8601
  isCurrent: boolean;
}

/** Time/equipe participante de um evento. */
export interface Team {
  id: string;
  name: string;
  shortName: string;
  /** Sigla curta usada em tabelas compactas, ex.: "FLA". */
  abbreviation?: string;
  logoUrl?: string;
  country?: string;
}

// ============================================================================
// Eventos (jogos/partidas)
// ============================================================================

export type EventStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "postponed"
  | "cancelled";

/** Um jogo/partida — a unidade central em torno da qual odds e previsões giram. */
export interface Event {
  id: string;
  sport: SportKey;
  leagueId: string;
  seasonId: string;
  homeTeam: Team;
  awayTeam: Team;
  /** Horário programado do apito inicial (ISO 8601, UTC). */
  kickoffAt: string;
  status: EventStatus;
  /** Placar atual, quando `status` é "live" ou "finished". */
  score?: {
    home: number;
    away: number;
  };
  /** Rodada/fase da competição, ex.: "Rodada 12", "Quartas de final". */
  round?: string;
  venue?: string;
}

// ============================================================================
// Casas de apostas
// ============================================================================

/**
 * Casa de apostas monitorada, com métricas de SPA (Sharp/Soft Provider Analysis
 * — o quão "afiada"/confiável é a casa para detectar movimentos de linha reais).
 */
export interface Bookmaker {
  id: string;
  name: string;
  shortName: string;
  logoUrl?: string;
  /** Regiões/mercados onde a casa opera, ex.: ["BR"]. */
  regions: string[];
  /** Indica se a casa é considerada "sharp" (linha de referência para o mercado). */
  isSharp: boolean;
  /** Overround médio histórico da casa, como fração (ex.: 0.05 = 5%). */
  averageOverround?: number;
  /** Latência média de atualização de odds, em segundos. */
  updateLatencySeconds?: number;
  /** Nota de confiabilidade calculada pelo motor (0–100). */
  spaScore?: number;
}

// ============================================================================
// Mercados, resultados e odds
// ============================================================================

/** Tipo de mercado de apostas. */
export type MarketType =
  | "moneyline" // 1x2 / vencedor da partida
  | "spread" // handicap
  | "totals" // over/under
  | "btts" // ambas equipes marcam
  | "double_chance"
  | "correct_score"
  | "player_props"
  | "team_props";

/** Um mercado oferecido para um evento (ex.: "Total de gols — Mais/Menos 2.5"). */
export interface Market {
  id: string;
  eventId: string;
  type: MarketType;
  /** Nome amigável exibido na UI, ex.: "Resultado Final". */
  label: string;
  /** Linha de referência, quando aplicável (ex.: 2.5 em totals/spread). */
  line?: number;
  outcomes: Outcome[];
}

/** Um resultado possível dentro de um mercado (ex.: "Casa", "Empate", "Fora"). */
export interface Outcome {
  id: string;
  marketId: string;
  /** Nome do resultado, ex.: "Mais de 2.5", "Flamengo". */
  label: string;
  /** Identifica o lado/seleção de forma estável entre casas, ex.: "home" | "over" | "under". */
  selectionKey: string;
}

/** Cotação (odd) de um resultado em uma casa específica, em um instante. */
export interface Odds {
  id: string;
  outcomeId: string;
  bookmakerId: string;
  /** Odds decimais (formato europeu), ex.: 2.35. */
  decimalOdds: number;
  /** Momento da captura desta cotação (ISO 8601). */
  capturedAt: string;
  /** Indica se esta é a cotação mais recente para o par outcome/bookmaker. */
  isLatest: boolean;
}

// ============================================================================
// Previsões e oportunidades de valor
// ============================================================================

/** Previsão gerada pelo motor estatístico para um resultado específico. */
export interface Prediction {
  id: string;
  eventId: string;
  outcomeId: string;
  /** Probabilidade estimada pelo modelo (0–1). */
  modelProbability: number;
  /** Identificador do modelo/versão que gerou a previsão, ex.: "poisson-v2". */
  modelId: string;
  /** Odds "justas" implícitas pela probabilidade do modelo. */
  fairOdds: number;
  generatedAt: string;
  /** Intervalo de confiança da estimativa, quando disponível. */
  confidenceInterval?: {
    lower: number;
    upper: number;
  };
}

/**
 * Oportunidade de valor (value bet) — quando a odds de mercado excede a odds
 * justa calculada pelo modelo em uma margem relevante.
 */
export interface ValueOpportunity {
  id: string;
  eventId: string;
  outcomeId: string;
  bookmakerId: string;
  predictionId: string;
  /** Odds oferecida atualmente pela casa. */
  marketOdds: number;
  /** Odds justa segundo o modelo. */
  fairOdds: number;
  /** Vantagem percentual sobre a odds justa (ex.: 0.08 = 8% de valor). */
  edgePercentage: number;
  edgeScore: EdgeScore;
  detectedAt: string;
  /** Indica se a oportunidade ainda está disponível na casa. */
  isActive: boolean;
}

/** Nota consolidada de confiança/qualidade de uma oportunidade (0–100). */
export interface EdgeScore {
  /** Nota final consolidada. */
  value: number;
  /** Classificação textual da nota, para exibição rápida na UI. */
  tier: "baixo" | "moderado" | "alto" | "excelente";
  /** Componentes que formam a nota, para transparência ao usuário. */
  components: {
    /** Confiabilidade do modelo estatístico usado. */
    modelConfidence: number;
    /** Qualidade/confiabilidade das casas usadas como referência (SPA). */
    marketConfidence: number;
    /** Quão estável a linha tem se mantido (menos volátil = mais confiável). */
    lineStability: number;
  };
}

// ============================================================================
// Usuário
// ============================================================================

export type SubscriptionPlan = "gratuito" | "pro" | "premium";

/** Perfil básico do usuário autenticado, espelhando a tabela `profiles` no Supabase. */
export interface User {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  plan: SubscriptionPlan;
  createdAt: string;
  /** Preferência de esportes favoritos, usada para personalizar o dashboard. */
  favoriteSports?: SportKey[];
}
