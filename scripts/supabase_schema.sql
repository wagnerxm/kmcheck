-- ================================================================
-- KM CHECK — schema do Supabase
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez só).
-- ================================================================

-- pontos das rodovias (populado/atualizado pelo script de sincronização)
create table if not exists pontos_rodovia (
  id bigint generated always as identity primary key,
  rodovia_id text not null,
  br text not null,
  uf text not null,
  km numeric not null,
  lat double precision not null,
  lon double precision not null,
  atualizado_em timestamptz not null default now(),
  unique (rodovia_id, km)
);
create index if not exists idx_pontos_rodovia_id on pontos_rodovia (rodovia_id);

alter table pontos_rodovia enable row level security;

drop policy if exists "leitura publica pontos" on pontos_rodovia;
create policy "leitura publica pontos" on pontos_rodovia
  for select using (true);

create table if not exists historico_fotos (
  id bigint generated always as identity primary key,
  url text not null,
  rodovia text,
  km numeric,
  lat double precision,
  lon double precision,
  criado_em timestamptz not null default now()
);

alter table historico_fotos enable row level security;

drop policy if exists "leitura publica fotos" on historico_fotos;
create policy "leitura publica fotos" on historico_fotos
  for select using (true);

drop policy if exists "insercao publica fotos" on historico_fotos;
create policy "insercao publica fotos" on historico_fotos
  for insert with check (true);
