-- =============================================================================
-- 009_rls_policies.sql
-- Row Level Security (RLS) — habilitada em TODAS as tabelas de public,
-- postura "secure by default" do Supabase: mesmo tabelas de catálogo público
-- (ligas, times) têm RLS habilitado com uma policy explícita de leitura, em
-- vez de depender apenas de GRANT de schema.
--
-- Papéis do Supabase usados nas policies:
--   anon           — visitante não autenticado.
--   authenticated  — qualquer usuário logado (JWT válido); auth.uid() identifica o usuário.
--   service_role   — contorna RLS por padrão no Supabase (bypassrls), usado por
--                     workers/Edge Functions de ingestão. Nenhuma policy é
--                     necessária para ele: INSERT/UPDATE/DELETE nas tabelas
--                     abaixo ficam implicitamente negados para anon/authenticated
--                     (nenhuma policy de escrita é criada para eles), exceto
--                     quando explicitamente liberado (users/alerts/favorites,
--                     dados do próprio usuário) ou via override de admin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Habilita RLS em todas as tabelas.
-- -----------------------------------------------------------------------------
alter table public.users                  enable row level security;
alter table public.sports                 enable row level security;
alter table public.leagues                enable row level security;
alter table public.seasons                enable row level security;
alter table public.teams                  enable row level security;
alter table public.players                enable row level security;
alter table public.events                 enable row level security;
alter table public.lineups                enable row level security;
alter table public.injuries               enable row level security;
alter table public.bookmakers             enable row level security;
alter table public.markets                enable row level security;
alter table public.outcomes               enable row level security;
alter table public.odds                   enable row level security;
alter table public.odds_history           enable row level security;
alter table public.team_stats             enable row level security;
alter table public.player_stats           enable row level security;
alter table public.model_versions         enable row level security;
alter table public.model_predictions      enable row level security;
alter table public.consensus_predictions  enable row level security;
alter table public.model_performance      enable row level security;
alter table public.value_opportunities    enable row level security;
alter table public.alerts                 enable row level security;
alter table public.favorites              enable row level security;

-- Trava adicional de defesa em profundidade: o papel usado pela API pública
-- (PostgREST, roles anon/authenticated) NUNCA deve conseguir UPDATE/DELETE nas
-- tabelas append-only, mesmo que uma policy seja mal configurada no futuro.
-- (Complementa o trigger fn_protect_append_only criado em 005_odds.sql.)
revoke update, delete on public.odds_history      from anon, authenticated;
revoke update, delete on public.model_predictions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2) Funções auxiliares de policy.
-- -----------------------------------------------------------------------------
create or replace function public.fn_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role in ('admin','service') and deleted_at is null
  );
$$;

comment on function public.fn_is_admin is
  'true quando o usuário autenticado tem role admin/service em public.users. Usada como policy de override administrativo em todas as tabelas.';

create or replace function public.fn_current_tier() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select subscription_tier from public.users where id = auth.uid() and deleted_at is null),
    'anonymous'
  );
$$;

-- Compara o plano do usuário contra um plano mínimo exigido, respeitando a
-- ordem free < basic < pro < enterprise.
create or replace function public.fn_has_min_tier(min_tier text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.fn_current_tier()
    when 'enterprise' then true
    when 'pro'        then min_tier in ('free','basic','pro')
    when 'basic'      then min_tier in ('free','basic')
    when 'free'       then min_tier = 'free'
    else false
  end;
$$;

comment on function public.fn_has_min_tier is
  'Usado nas policies de leitura de dados analíticos (odds_history, model_predictions, consensus_predictions, value_opportunities) para gating por plano de assinatura (freemium).';

-- -----------------------------------------------------------------------------
-- 3) Tabelas de catálogo/referência — leitura livre (inclusive anon, para
-- permitir páginas públicas de marketing/SEO tipo "próximos jogos"). Escrita
-- restrita a service_role (implícita — nenhuma policy de INSERT/UPDATE/DELETE
-- é criada para anon/authenticated) e ao papel admin via override (§5).
-- -----------------------------------------------------------------------------
create policy sports_select_all        on public.sports        for select using (true);
create policy leagues_select_all       on public.leagues       for select using (true);
create policy seasons_select_all       on public.seasons       for select using (true);
create policy teams_select_all         on public.teams         for select using (true);
create policy players_select_all       on public.players       for select using (true);
create policy events_select_all        on public.events        for select using (true);
create policy lineups_select_all       on public.lineups       for select using (true);
create policy injuries_select_all      on public.injuries      for select using (true);
create policy bookmakers_select_all    on public.bookmakers    for select using (true);
create policy markets_select_all       on public.markets       for select using (true);
create policy outcomes_select_all      on public.outcomes      for select using (true);
create policy odds_select_all          on public.odds          for select using (true);
create policy team_stats_select_all    on public.team_stats    for select using (true);
create policy player_stats_select_all  on public.player_stats  for select using (true);

-- -----------------------------------------------------------------------------
-- 4) Dados analíticos com gating por plano (freemium) — o diferencial
-- competitivo do produto. Leitura exige autenticação; profundidade
-- histórica/latência é escalonada por subscription_tier:
--   free/basic  -> odds_history só das últimas 24h; model_predictions/
--                  consensus_predictions/value_opportunities com atraso de 60min.
--   pro/enterprise -> acesso completo, tempo real, sem atraso nem corte.
-- -----------------------------------------------------------------------------
create policy odds_history_select_tiered on public.odds_history
  for select to authenticated using (
    public.fn_has_min_tier('pro')
    or recorded_at >= now() - interval '24 hours'
  );

create policy model_predictions_select_tiered on public.model_predictions
  for select to authenticated using (
    public.fn_has_min_tier('pro')
    or generated_at <= now() - interval '60 minutes'
  );

create policy consensus_predictions_select_tiered on public.consensus_predictions
  for select to authenticated using (
    public.fn_has_min_tier('pro')
    or generated_at <= now() - interval '60 minutes'
  );

create policy value_opportunities_select_tiered on public.value_opportunities
  for select to authenticated using (
    public.fn_has_min_tier('pro')
    or detected_at <= now() - interval '60 minutes'
  );

-- model_performance (métricas agregadas, não é "sinal" acionável em si) é
-- liberado a todo autenticado.
create policy model_performance_select_authenticated on public.model_performance
  for select to authenticated using (true);

-- model_versions: metadados visíveis a todo autenticado. hyperparameters
-- pode conter propriedade intelectual do modelo — recomenda-se, no futuro,
-- expor aos tiers não-enterprise apenas uma view sem essa coluna.
create policy model_versions_select_authenticated on public.model_versions
  for select to authenticated using (true);

-- Escrita nas tabelas analíticas é EXCLUSIVA de service_role
-- (pipelines/Edge Functions) — nenhuma policy de INSERT/UPDATE/DELETE é
-- criada para authenticated/anon, ficando implicitamente negada. odds_history
-- e model_predictions, além disso, já têm UPDATE/DELETE revogados acima e
-- bloqueados por trigger.

-- -----------------------------------------------------------------------------
-- 5) Dados privados do usuário (tenant isolation) — isolamento estrito por
-- auth.uid().
-- -----------------------------------------------------------------------------
create policy users_select_own on public.users
  for select using (id = auth.uid() or public.fn_is_admin());
create policy users_update_own on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());
-- INSERT em users é feito apenas pelo trigger handle_new_user (security
-- definer, ver 002_core_entities.sql) — sem policy de insert para authenticated.

create policy alerts_select_own on public.alerts
  for select using (user_id = auth.uid());
create policy alerts_insert_own on public.alerts
  for insert with check (user_id = auth.uid());
create policy alerts_update_own on public.alerts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy alerts_delete_own on public.alerts
  for delete using (user_id = auth.uid());

create policy favorites_select_own on public.favorites
  for select using (user_id = auth.uid());
create policy favorites_insert_own on public.favorites
  for insert with check (user_id = auth.uid());
create policy favorites_delete_own on public.favorites
  for delete using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6) Acesso administrativo — toda tabela recebe adicionalmente uma policy
-- `for all using (fn_is_admin())`, dando aos usuários com role = 'admin' (via
-- seu próprio JWT, não via service_role) acesso total pelo painel de
-- back-office, com o mesmo rastro de auditoria de qualquer outro usuário
-- autenticado (diferente de service_role, que é uma credencial de sistema).
--
-- Observação: em odds_history/model_predictions, o UPDATE/DELETE continua
-- fisicamente bloqueado pelo trigger fn_protect_append_only mesmo para admin
-- — a policy abaixo apenas cobre o INSERT administrativo (ex.: backfill
-- manual) nessas duas tabelas.
-- -----------------------------------------------------------------------------
create policy sports_admin_all                on public.sports                for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy leagues_admin_all               on public.leagues               for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy seasons_admin_all               on public.seasons               for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy teams_admin_all                 on public.teams                 for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy players_admin_all               on public.players               for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy events_admin_all                on public.events                for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy lineups_admin_all               on public.lineups               for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy injuries_admin_all              on public.injuries              for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy bookmakers_admin_all            on public.bookmakers            for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy markets_admin_all               on public.markets               for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy outcomes_admin_all              on public.outcomes              for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy odds_admin_all                  on public.odds                  for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy odds_history_admin_all          on public.odds_history          for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy team_stats_admin_all            on public.team_stats            for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy player_stats_admin_all          on public.player_stats          for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy model_versions_admin_all        on public.model_versions        for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy model_predictions_admin_all     on public.model_predictions     for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy consensus_predictions_admin_all on public.consensus_predictions for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy model_performance_admin_all     on public.model_performance     for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy value_opportunities_admin_all   on public.value_opportunities   for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy alerts_admin_all                on public.alerts                for all using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy favorites_admin_all             on public.favorites             for all using (public.fn_is_admin()) with check (public.fn_is_admin());
-- users já tem policy própria de select/update acima; admin cobre também insert/delete administrativo.
create policy users_admin_all                 on public.users                 for all using (public.fn_is_admin()) with check (public.fn_is_admin());
