/**
 * Entity Resolver — resolve IDs externos de provedores para IDs internos (UUID).
 *
 * Quando o provedor de odds retorna um evento com times, liga e casas de apostas
 * identificados por IDs/nomes externos, este módulo:
 *
 * 1. Busca o ID interno correspondente na tabela relevante (via external_ids JSONB
 *    ou provider_*_id).
 * 2. Se não encontrar, cria a entidade automaticamente (upsert).
 * 3. Mantém um cache em memória para evitar queries repetidas dentro do mesmo batch.
 *
 * O cache é invalidado a cada ciclo de coleta (instância descartada), garantindo
 * que mudanças feitas por outros processos sejam eventualmente captadas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

const log = logger.child({ module: 'entity-resolver' });

export class EntityResolver {
  /** Cache: "tabela:provider:externalId" → UUID interno. */
  private cache = new Map<string, string>();
  private readonly db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.db = db;
  }

  // ---------------------------------------------------------------------------
  // Ligas
  // ---------------------------------------------------------------------------

  /**
   * Resolve liga pelo ID externo no provedor. Cria se não existir.
   *
   * @param provider - Nome do provedor (ex.: "sportsgameodds")
   * @param externalId - ID da liga no provedor
   * @param name - Nome legível da liga (usado no upsert)
   * @param sportId - UUID do esporte interno (buscado uma vez no boot)
   */
  async resolveLeague(
    provider: string,
    externalId: string,
    name: string,
    sportId: string,
  ): Promise<string | null> {
    const cacheKey = `leagues:${provider}:${externalId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Buscar por provider + provider_league_id
    const { data: existing } = await this.db
      .from('leagues')
      .select('id')
      .eq('provider', provider)
      .eq('provider_league_id', externalId)
      .maybeSingle();

    if (existing) {
      this.cache.set(cacheKey, existing.id);
      return existing.id;
    }

    // Upsert: criar liga com dados mínimos
    const { data: created, error } = await this.db
      .from('leagues')
      .upsert(
        {
          sport_id: sportId,
          name,
          provider,
          provider_league_id: externalId,
          external_ids: { [provider]: externalId },
          active: true,
        },
        { onConflict: 'sport_id,provider,provider_league_id' },
      )
      .select('id')
      .single();

    if (error) {
      log.error({ provider, externalId, name, error: error.message }, 'Falha ao criar liga');
      return null;
    }

    this.cache.set(cacheKey, created.id);
    log.info({ id: created.id, name }, 'Nova liga criada automaticamente');
    return created.id;
  }

  // ---------------------------------------------------------------------------
  // Times
  // ---------------------------------------------------------------------------

  async resolveTeam(
    provider: string,
    externalId: string,
    name: string,
    sportId: string,
    leagueId?: string,
  ): Promise<string | null> {
    const cacheKey = `teams:${provider}:${externalId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const { data: existing } = await this.db
      .from('teams')
      .select('id')
      .eq('provider', provider)
      .eq('provider_team_id', externalId)
      .maybeSingle();

    if (existing) {
      this.cache.set(cacheKey, existing.id);
      return existing.id;
    }

    const { data: created, error } = await this.db
      .from('teams')
      .upsert(
        {
          sport_id: sportId,
          league_id: leagueId ?? null,
          name,
          provider,
          provider_team_id: externalId,
          external_ids: { [provider]: externalId },
          active: true,
        },
        { onConflict: 'provider,provider_team_id' },
      )
      .select('id')
      .single();

    if (error) {
      log.error({ provider, externalId, name, error: error.message }, 'Falha ao criar time');
      return null;
    }

    this.cache.set(cacheKey, created.id);
    log.info({ id: created.id, name }, 'Novo time criado automaticamente');
    return created.id;
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------

  /**
   * Resolve evento por external_id JSONB. Cria se não existir.
   *
   * Eventos usam external_ids (JSONB) para mapeamento multi-provedor,
   * diferente de leagues/teams que usam provider + provider_*_id.
   */
  async resolveEvent(
    provider: string,
    externalId: string,
    data: {
      sportId: string;
      leagueId: string;
      homeTeamId: string;
      awayTeamId: string;
      kickoffAt: string;
      status: string;
      homeScore?: number;
      awayScore?: number;
    },
  ): Promise<string | null> {
    const cacheKey = `events:${provider}:${externalId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Buscar pelo external_id no JSONB
    const { data: existing } = await this.db
      .from('events')
      .select('id')
      .contains('external_ids', { [provider]: externalId })
      .maybeSingle();

    if (existing) {
      this.cache.set(cacheKey, existing.id);

      // Atualizar status e placar se o evento já existe
      await this.db
        .from('events')
        .update({
          status: data.status,
          home_score: data.homeScore ?? null,
          away_score: data.awayScore ?? null,
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      return existing.id;
    }

    // Criar evento novo
    const { data: created, error } = await this.db
      .from('events')
      .insert({
        sport_id: data.sportId,
        league_id: data.leagueId,
        home_team_id: data.homeTeamId,
        away_team_id: data.awayTeamId,
        kickoff_at: data.kickoffAt,
        status: data.status,
        home_score: data.homeScore ?? null,
        away_score: data.awayScore ?? null,
        external_ids: { [provider]: externalId },
        provider_primary: provider,
        last_synced_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      // Possível conflito de unique (home_team_id, away_team_id, kickoff_at)
      // Tentar buscar pelo matching natural
      if (error.code === '23505') {
        const { data: fallback } = await this.db
          .from('events')
          .select('id')
          .eq('home_team_id', data.homeTeamId)
          .eq('away_team_id', data.awayTeamId)
          .eq('kickoff_at', data.kickoffAt)
          .maybeSingle();

        if (fallback) {
          // Adicionar o external_id ao evento existente
          await this.db.rpc('jsonb_merge_external_id', {
            p_table: 'events',
            p_id: fallback.id,
            p_provider: provider,
            p_external_id: externalId,
          }).then(() => null, () => {
            // Fallback: update direto se a RPC não existir
            this.db
              .from('events')
              .update({
                external_ids: { [provider]: externalId },
                last_synced_at: new Date().toISOString(),
              })
              .eq('id', fallback.id)
              .then(() => null, () => null);
          });

          this.cache.set(cacheKey, fallback.id);
          return fallback.id;
        }
      }

      log.error({ provider, externalId, error: error.message }, 'Falha ao criar evento');
      return null;
    }

    this.cache.set(cacheKey, created.id);
    return created.id;
  }

  // ---------------------------------------------------------------------------
  // Casas de apostas
  // ---------------------------------------------------------------------------

  /**
   * Resolve bookmaker pelo slug. Não cria automaticamente — casas devem
   * ser cadastradas previamente (seed data ou admin).
   *
   * Se não encontrar, retorna null (odds dessa casa são ignoradas nesta coleta).
   */
  async resolveBookmaker(slug: string): Promise<string | null> {
    const cacheKey = `bookmakers:slug:${slug}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const { data: existing } = await this.db
      .from('bookmakers')
      .select('id')
      .eq('slug', slug)
      .eq('active', true)
      .maybeSingle();

    if (existing) {
      this.cache.set(cacheKey, existing.id);
      return existing.id;
    }

    // Tentar pelo provider_bookmaker_id (algumas casas usam slug diferente)
    const { data: byProvider } = await this.db
      .from('bookmakers')
      .select('id')
      .eq('provider_bookmaker_id', slug)
      .eq('active', true)
      .maybeSingle();

    if (byProvider) {
      this.cache.set(cacheKey, byProvider.id);
      return byProvider.id;
    }

    // Casa não cadastrada — loggar para revisão mas não bloquear
    log.debug({ slug }, 'Casa de apostas não encontrada no banco (ignorando odds)');
    // Cachear como "não encontrado" para evitar queries repetidas
    this.cache.set(cacheKey, '__NOT_FOUND__');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Mercados e outcomes
  // ---------------------------------------------------------------------------

  /**
   * Resolve mercado pela chave interna (ex.: "moneyline", "totals_2.5").
   * Mercados são cadastrados no seed — não cria automaticamente.
   */
  async resolveMarket(key: string): Promise<string | null> {
    const cacheKey = `markets:key:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached === '__NOT_FOUND__' ? null : cached;

    const { data: existing } = await this.db
      .from('markets')
      .select('id')
      .eq('key', key)
      .eq('active', true)
      .maybeSingle();

    if (existing) {
      this.cache.set(cacheKey, existing.id);
      return existing.id;
    }

    this.cache.set(cacheKey, '__NOT_FOUND__');
    log.debug({ key }, 'Mercado não encontrado (ignorando)');
    return null;
  }

  /**
   * Resolve outcome pela chave dentro de um mercado.
   */
  async resolveOutcome(marketId: string, key: string): Promise<string | null> {
    const cacheKey = `outcomes:${marketId}:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached === '__NOT_FOUND__' ? null : cached;

    const { data: existing } = await this.db
      .from('outcomes')
      .select('id')
      .eq('market_id', marketId)
      .eq('key', key)
      .maybeSingle();

    if (existing) {
      this.cache.set(cacheKey, existing.id);
      return existing.id;
    }

    this.cache.set(cacheKey, '__NOT_FOUND__');
    log.debug({ marketId, key }, 'Outcome não encontrado (ignorando)');
    return null;
  }

  // ---------------------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------------------

  /** ID do esporte "football" — carregado uma vez e cacheado. */
  async getFootballSportId(): Promise<string> {
    const cacheKey = 'sports:code:football';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.db
      .from('sports')
      .select('id')
      .eq('code', 'football')
      .single();

    if (error || !data) {
      throw new Error('Esporte "football" não encontrado na tabela sports. Execute o seed primeiro.');
    }

    this.cache.set(cacheKey, data.id);
    return data.id;
  }

  /** Limpa o cache em memória (chamado entre ciclos de coleta). */
  clearCache(): void {
    this.cache.clear();
  }

  /** Estatísticas do cache para monitoramento. */
  getCacheStats(): { size: number } {
    return { size: this.cache.size };
  }
}
