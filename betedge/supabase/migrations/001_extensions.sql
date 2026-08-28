-- =============================================================================
-- 001_extensions.sql
-- Extensões do PostgreSQL necessárias para o schema do BetEdge.
-- Em um projeto Supabase, o role de migration roda com privilégio de
-- superusuário/`supabase_admin`, então os `CREATE EXTENSION` abaixo funcionam
-- de ponta a ponta. `pgcrypto` e `pgjwt` já vêm habilitadas por padrão nos
-- projetos Supabase; mantemos aqui de forma idempotente para também funcionar
-- em Postgres local puro (Docker Compose) usado no desenvolvimento.
-- =============================================================================

-- uuid-ossp: gerador alternativo de UUID (uuid_generate_v4()). Mantido por
-- compatibilidade com ferramentas/clientes que ainda dependem dele; a chave
-- primária de toda tabela do schema usa gen_random_uuid() (pgcrypto), que é
-- mais leve e não exige esta extensão — ela fica disponível apenas como rede
-- de segurança.
create extension if not exists "uuid-ossp";

-- pgcrypto: fornece gen_random_uuid(), usada como default de praticamente
-- toda coluna `id` do schema.
create extension if not exists "pgcrypto";

-- pg_trgm: habilita busca fuzzy (trigram) em nomes de time/jogador/liga,
-- acelerando consultas `ILIKE '%termo%'` via índice GIN em vez de sequential
-- scan — essencial para a busca da UI ("digite o nome do time").
create extension if not exists "pg_trgm";

-- btree_gin: permite índices GIN compostos misturando colunas escalares
-- (ex.: status) com colunas jsonb, usados em alguns índices analíticos.
create extension if not exists "btree_gin";

-- pg_cron: agendamento nativo de manutenção de partições (criação das
-- partições mensais futuras de odds_history/model_predictions) e de refresh
-- periódico das views materializadas. No Supabase gerenciado normalmente já
-- vem habilitada; em Postgres puro (ex.: a imagem `postgres:15` do Docker
-- Compose local) ela nem sequer está instalada (não é um módulo padrão do
-- contrib) — por isso o CREATE EXTENSION é envolvido num bloco que tolera a
-- ausência, em vez de derrubar a migration inteira. Todo código que depende
-- de pg_cron (agendamento de refresh de views, manutenção de partições) já
-- verifica `pg_extension` antes de chamar `cron.schedule(...)` — ver
-- 010_views.sql e 011_functions.sql. Em produção (Supabase), habilite-a via
-- dashboard (Database → Extensions) antes de aplicar as migrations para que
-- os jobs agendados realmente entrem em vigor.
do $$
begin
  create extension if not exists "pg_cron";
exception when others then
  raise notice 'Extensão pg_cron indisponível neste ambiente (ok em Postgres local/CI) — agendamentos que dependem dela ficam desativados até ela ser habilitada.';
end;
$$;

-- pg_stat_statements: observabilidade de queries lentas — usada por
-- ferramentas de monitoramento/APM para identificar consultas custosas nas
-- tabelas particionadas de séries temporais. Também tolerada como opcional,
-- pois requer a lib compartilhada carregada via `shared_preload_libraries`
-- para coletar estatísticas de fato (sem isso, a extensão apenas fica ociosa).
do $$
begin
  create extension if not exists "pg_stat_statements";
exception when others then
  raise notice 'Extensão pg_stat_statements indisponível neste ambiente — observabilidade de queries lentas fica desativada.';
end;
$$;
