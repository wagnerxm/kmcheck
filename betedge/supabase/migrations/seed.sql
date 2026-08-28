-- =============================================================================
-- seed.sql
-- Dados de referência (seed) do BetEdge: esporte, mercados/resultados, casas
-- de apostas (com compliance SPA/MF) e principais ligas + temporada corrente.
--
-- Idempotente: seguro reexecutar (usa ON CONFLICT DO NOTHING / DO UPDATE onde
-- aplicável). Não é uma migration numerada de schema — roda depois de todas
-- as 001..011 (supabase db seed, ou `psql -f seed.sql` manual).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Esportes
-- -----------------------------------------------------------------------------
insert into public.sports (code, name, name_pt, icon, display_order)
values ('football', 'Football / Soccer', 'Futebol', 'circle-dot', 1)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- Mercados (catálogo normalizado) — 1X2, Chance Dupla, Empate Anula a Aposta,
-- Handicap Asiático, Mais/Menos Gols, Ambas Marcam, Total de Gols por Equipe.
-- -----------------------------------------------------------------------------
with s as (select id from public.sports where code = 'football')
insert into public.markets (sport_id, code, name, name_pt, category, has_line, is_two_way, normalization)
select s.id, v.code, v.name, v.name_pt, v.category, v.has_line, v.is_two_way, v.normalization
from s, (values
  ('1x2',          '1X2 / Match Result',   'Resultado Final (1X2)',      'match_result',        false, false, 'margin_proportional'),
  ('double_chance','Double Chance',        'Chance Dupla',                'match_result',        false, false, 'margin_proportional'),
  ('dnb',          'Draw No Bet',          'Empate Anula a Aposta',       'match_result',        false, true,  'margin_proportional'),
  ('ah',           'Asian Handicap',       'Handicap Asiático',           'handicap',             true,  true,  'margin_proportional'),
  ('ou',           'Over/Under',           'Mais/Menos Gols',             'totals',               true,  true,  'margin_proportional'),
  ('btts',         'Both Teams to Score',  'Ambas Marcam',                'both_teams_to_score', false, true,  'margin_proportional'),
  ('team_totals',  'Team Totals',          'Total de Gols por Equipe',    'team_totals',          true,  true,  'margin_proportional')
) as v(code, name, name_pt, category, has_line, is_two_way, normalization)
on conflict (sport_id, code) do nothing;

-- -----------------------------------------------------------------------------
-- Resultados (outcomes) de cada mercado.
-- -----------------------------------------------------------------------------

-- 1X2
insert into public.outcomes (market_id, code, name, name_pt, display_order)
select m.id, x.code, x.name, x.name_pt, x.ord
from public.markets m, (values
  ('home','Home','Casa',1), ('draw','Draw','Empate',2), ('away','Away','Fora',3)
) as x(code,name,name_pt,ord)
where m.code = '1x2'
on conflict (market_id, code, line) do nothing;

-- Chance Dupla (Double Chance)
insert into public.outcomes (market_id, code, name, name_pt, display_order)
select m.id, x.code, x.name, x.name_pt, x.ord
from public.markets m, (values
  ('home_or_draw','Home or Draw','Casa ou Empate',1),
  ('home_or_away','Home or Away','Casa ou Fora',2),
  ('away_or_draw','Away or Draw','Fora ou Empate',3)
) as x(code,name,name_pt,ord)
where m.code = 'double_chance'
on conflict (market_id, code, line) do nothing;

-- Empate Anula a Aposta (Draw No Bet)
insert into public.outcomes (market_id, code, name, name_pt, display_order)
select m.id, x.code, x.name, x.name_pt, x.ord
from public.markets m, (values
  ('home','Home','Casa',1), ('away','Away','Fora',2)
) as x(code,name,name_pt,ord)
where m.code = 'dnb'
on conflict (market_id, code, line) do nothing;

-- Handicap Asiático — linha inicial de exemplo -1.5/+1.5; linhas adicionais
-- por evento vêm da ingestão de odds (cada linha nova é um outcome novo).
insert into public.outcomes (market_id, code, name, name_pt, line, display_order)
select m.id, x.code, x.name, x.name_pt, x.line, x.ord
from public.markets m, (values
  ('home','Home -1.5','Casa -1.5',-1.5,1),
  ('away','Away +1.5','Fora +1.5', 1.5,2)
) as x(code,name,name_pt,line,ord)
where m.code = 'ah'
on conflict (market_id, code, line) do nothing;

-- Mais/Menos Gols — linha padrão inicial 2.5; outras linhas (1.5, 3.5, ...)
-- inseridas conforme cobertura de dados da ingestão.
insert into public.outcomes (market_id, code, name, name_pt, line, display_order)
select m.id, x.code, x.name, x.name_pt, x.line, x.ord
from public.markets m, (values
  ('over','Over 2.5','Mais de 2.5', 2.5,1),
  ('under','Under 2.5','Menos de 2.5',2.5,2)
) as x(code,name,name_pt,line,ord)
where m.code = 'ou'
on conflict (market_id, code, line) do nothing;

-- Ambas Marcam (Both Teams to Score)
insert into public.outcomes (market_id, code, name, name_pt, display_order)
select m.id, x.code, x.name, x.name_pt, x.ord
from public.markets m, (values
  ('yes','Yes','Sim',1), ('no','No','Não',2)
) as x(code,name,name_pt,ord)
where m.code = 'btts'
on conflict (market_id, code, line) do nothing;

-- Total de Gols por Equipe — linha padrão inicial 1.5 para cada lado.
insert into public.outcomes (market_id, code, name, name_pt, line, display_order)
select m.id, x.code, x.name, x.name_pt, x.line, x.ord
from public.markets m, (values
  ('home_over', 'Home Over 1.5', 'Casa Mais de 1.5', 1.5,1),
  ('home_under','Home Under 1.5','Casa Menos de 1.5',1.5,2),
  ('away_over', 'Away Over 1.5', 'Fora Mais de 1.5', 1.5,3),
  ('away_under','Away Under 1.5','Fora Menos de 1.5',1.5,4)
) as x(code,name,name_pt,line,ord)
where m.code = 'team_totals'
on conflict (market_id, code, line) do nothing;

-- -----------------------------------------------------------------------------
-- Casas de apostas (bookmakers)
--
-- ATENÇÃO: os campos spa_authorized/spa_company/spa_authorization/
-- spa_authorization_date abaixo são ILUSTRATIVOS (dados de exemplo para
-- desenvolvimento) — antes de qualquer uso em produção, devem ser
-- substituídos pelos dados reais e vigentes do Registro de Agentes
-- Operadores de Apostas publicado pela Secretaria de Prêmios e Apostas do
-- Ministério da Fazenda (gov.br/fazenda), atualizado continuamente pelo job
-- de verificação de compliance (spa_last_checked_at).
-- -----------------------------------------------------------------------------
insert into public.bookmakers
  (name, slug, domain, spa_authorized, spa_company, spa_authorization, spa_authorization_date, provider, provider_bookmaker_id, country_code)
values
  ('Bet365',       'bet365',       'bet365.bet.br',       true,  'Hillside (Brazil Sports Betting) Ltda.', 'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'bet365',       'BR'),
  ('Betano',       'betano',       'betano.bet.br',       true,  'Betano Brasil Ltda.',                     'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'betano',       'BR'),
  ('Sportingbet',  'sportingbet',  'sportingbet.bet.br',  true,  'Sportingbet Brasil Ltda.',                'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'sportingbet',  'BR'),
  ('KTO',          'kto',          'kto.bet.br',          true,  'KTO Brasil Ltda.',                        'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'kto',          'BR'),
  ('Betfair',      'betfair',      'betfair.bet.br',      true,  'Betfair Brasil Ltda.',                    'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'betfair',      'BR'),
  ('Superbet',     'superbet',     'superbet.bet.br',     true,  'Superbet Brasil Ltda.',                   'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'superbet',     'BR'),
  ('Novibet',      'novibet',      'novibet.bet.br',      true,  'Novibet Brasil Ltda.',                    'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'novibet',      'BR'),
  ('Betnacional',  'betnacional',  'betnacional.bet.br',  true,  'Lottoland/Betnacional Brasil Ltda.',      'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'betnacional',  'BR'),
  ('EstrelaBet',   'estrelabet',   'estrelabet.bet.br',   true,  'EstrelaBet Brasil Ltda.',                 'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'estrelabet',   'BR'),
  ('Parimatch',    'parimatch',    'parimatch.bet.br',    false, null,                                       null,                                                  null,          'odds-feed-v1', 'parimatch',    'BR'),
  ('F12.Bet',      'f12bet',       'f12.bet.br',          true,  'F12 Brasil Ltda.',                        'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'f12bet',       'BR'),
  ('Pixbet',       'pixbet',       'pixbet.bet.br',       true,  'Pixbet Brasil Ltda.',                     'SPA/MF Nº 000X/2025 (exemplo — validar em gov.br)', '2025-01-01', 'odds-feed-v1', 'pixbet',       'BR')
on conflict (provider, provider_bookmaker_id) do nothing;

comment on column public.bookmakers.spa_authorized is
  'Dados de autorização SPA são ilustrativos — validar no portal gov.br antes de uso em produção.';

-- -----------------------------------------------------------------------------
-- Principais ligas (catálogo inicial do MVP).
-- -----------------------------------------------------------------------------
with s as (select id from public.sports where code = 'football')
insert into public.leagues (sport_id, name, short_name, country_code, country_name, confederation, tier, provider, provider_league_id)
select s.id, v.name, v.short_name, v.country_code, v.country_name, v.confederation, v.tier, 'api-football', v.provider_id
from s, (values
  ('Campeonato Brasileiro Série A', 'Brasileirão A',   'BR', 'Brasil',      'CONMEBOL', 1, 'br-serie-a'),
  ('Campeonato Brasileiro Série B', 'Brasileirão B',   'BR', 'Brasil',      'CONMEBOL', 2, 'br-serie-b'),
  ('Copa do Brasil',                'Copa do Brasil',  'BR', 'Brasil',      'CONMEBOL', 1, 'br-copa-do-brasil'),
  ('Premier League',                'EPL',             'GB', 'Inglaterra',  'UEFA',     1, 'eng-premier-league'),
  ('La Liga',                       'La Liga',         'ES', 'Espanha',     'UEFA',     1, 'esp-la-liga'),
  ('Serie A',                       'Serie A',         'IT', 'Itália',      'UEFA',     1, 'ita-serie-a'),
  ('Bundesliga',                    'Bundesliga',      'DE', 'Alemanha',    'UEFA',     1, 'ger-bundesliga'),
  ('Ligue 1',                       'Ligue 1',         'FR', 'França',      'UEFA',     1, 'fra-ligue-1'),
  ('UEFA Champions League',         'Champions League', null, null,         'UEFA',     1, 'uefa-champions-league'),
  ('Copa Libertadores',             'Libertadores',     null, null,         'CONMEBOL', 1, 'conmebol-libertadores'),
  ('Copa Sul-Americana',            'Sul-Americana',    null, null,         'CONMEBOL', 2, 'conmebol-sudamericana'),
  ('Copa América',                  'Copa América',     null, null,         'CONMEBOL', 1, 'conmebol-copa-america')
) as v(name, short_name, country_code, country_name, confederation, tier, provider_id)
on conflict (sport_id, provider, provider_league_id) do nothing;

-- -----------------------------------------------------------------------------
-- Temporada corrente de cada liga (2026, com a temporada europeia no formato
-- 2025/2026 — ajuste manualmente conforme o calendário real de cada liga).
-- -----------------------------------------------------------------------------
insert into public.seasons (league_id, name, start_date, end_date, is_current)
select l.id, v.name, v.start_date::date, v.end_date::date, true
from public.leagues l, (values
  ('br-serie-a',              '2026',      '2026-03-29', '2026-12-06'),
  ('br-serie-b',               '2026',      '2026-04-04', '2026-11-21'),
  ('br-copa-do-brasil',        '2026',      '2026-02-18', '2026-11-04'),
  ('eng-premier-league',       '2025/2026', '2025-08-15', '2026-05-24'),
  ('esp-la-liga',              '2025/2026', '2025-08-15', '2026-05-24'),
  ('ita-serie-a',              '2025/2026', '2025-08-23', '2026-05-24'),
  ('ger-bundesliga',           '2025/2026', '2025-08-22', '2026-05-16'),
  ('fra-ligue-1',              '2025/2026', '2025-08-15', '2026-05-17'),
  ('uefa-champions-league',    '2025/2026', '2025-09-16', '2026-05-30'),
  ('conmebol-libertadores',    '2026',      '2026-02-03', '2026-11-28'),
  ('conmebol-sudamericana',    '2026',      '2026-03-03', '2026-11-21'),
  ('conmebol-copa-america',    '2027',      '2027-06-01', '2027-07-15')
) as v(provider_id, name, start_date, end_date)
where l.provider_league_id = v.provider_id
on conflict (league_id, name) do nothing;
