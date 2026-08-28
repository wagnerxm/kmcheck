/**
 * Configuração central dos workers Node, carregada de variáveis de ambiente.
 */
import "dotenv/config";

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const config = {
  redisUrl: requireEnv("REDIS_URL", "redis://localhost:6379/0"),
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  sportsGameOddsApiKey: process.env.SPORTS_GAME_ODDS_API_KEY ?? "",
  theOddsApiKey: process.env.THE_ODDS_API_KEY ?? "",
  /** Intervalo (ms) do polling recorrente de odds — configurável por ambiente. */
  oddsPollIntervalMs: Number(process.env.ODDS_POLL_INTERVAL_MS ?? 60_000),
} as const;
