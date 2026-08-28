/**
 * GET /api/odds/comparison/[eventId]
 *
 * Retorna todas as odds atuais de um evento, agrupadas por mercado e resultado,
 * com dados das casas de apostas (nome, slug, status SPA) e o destaque da
 * melhor odd de cada seleção. Dados vêm da tabela `odds` (materialização
 * do último estado via trigger de odds_history).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  if (!eventId) {
    return NextResponse.json({ error: "eventId é obrigatório" }, { status: 400 });
  }

  const supabase = await createClient();

  // ─── Buscar evento com times e liga ───────────────────────────────
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select(`
      id,
      kickoff_at,
      status,
      home_score,
      away_score,
      round,
      venue_name,
      home_team:teams!home_team_id ( id, name, short_name ),
      away_team:teams!away_team_id ( id, name, short_name ),
      league:leagues!league_id ( id, name, short_name, country_code )
    `)
    .eq("id", eventId)
    .single();

  if (eventError || !event) {
    return NextResponse.json(
      { error: "Evento não encontrado" },
      { status: 404 },
    );
  }

  // ─── Buscar todas as odds atuais do evento ────────────────────────
  const { data: oddsRows, error: oddsError } = await supabase
    .from("odds")
    .select(`
      id,
      decimal_odds,
      implied_probability,
      previous_odds,
      change_count,
      last_updated_at,
      is_suspended,
      line,
      bookmaker:bookmakers!bookmaker_id (
        id, name, slug, spa_authorized, spa_company, spa_authorization
      ),
      market:markets!market_id (
        id, code, name, name_pt, category, has_line
      ),
      outcome:outcomes!outcome_id (
        id, code, name, name_pt, line, display_order
      )
    `)
    .eq("event_id", eventId)
    .eq("is_suspended", false)
    .order("decimal_odds", { ascending: false });

  if (oddsError) {
    return NextResponse.json(
      { error: "Falha ao buscar odds", detail: oddsError.message },
      { status: 500 },
    );
  }

  // ─── Agrupar por mercado → outcome → casas ────────────────────────

  /** Mapa: marketCode → { market, outcomes: { outcomeCode → { outcome, bookmakers: [...] } } } */
  const marketMap = new Map<
    string,
    {
      market: (typeof oddsRows)[number]["market"];
      outcomes: Map<
        string,
        {
          outcome: (typeof oddsRows)[number]["outcome"];
          bookmakers: {
            bookmaker: (typeof oddsRows)[number]["bookmaker"];
            decimalOdds: number;
            impliedProbability: number;
            previousOdds: number | null;
            changeCount: number;
            lastUpdatedAt: string;
          }[];
        }
      >;
    }
  >();

  /** Conjunto de todas as casas presentes, para montar o cabeçalho da tabela. */
  const bookmakerSet = new Map<
    string,
    (typeof oddsRows)[number]["bookmaker"]
  >();

  for (const row of oddsRows ?? []) {
    if (!row.market || !row.outcome || !row.bookmaker) continue;

    const mCode = row.market.code + (row.outcome.line != null ? `_${row.outcome.line}` : "");
    if (!marketMap.has(mCode)) {
      marketMap.set(mCode, { market: row.market, outcomes: new Map() });
    }

    const oCode = row.outcome.code + (row.outcome.line != null ? `_${row.outcome.line}` : "");
    const marketEntry = marketMap.get(mCode)!;
    if (!marketEntry.outcomes.has(oCode)) {
      marketEntry.outcomes.set(oCode, { outcome: row.outcome, bookmakers: [] });
    }

    marketEntry.outcomes.get(oCode)!.bookmakers.push({
      bookmaker: row.bookmaker,
      decimalOdds: Number(row.decimal_odds),
      impliedProbability: Number(row.implied_probability),
      previousOdds: row.previous_odds != null ? Number(row.previous_odds) : null,
      changeCount: row.change_count,
      lastUpdatedAt: row.last_updated_at,
    });

    if (!bookmakerSet.has(row.bookmaker.id)) {
      bookmakerSet.set(row.bookmaker.id, row.bookmaker);
    }
  }

  // ─── Calcular melhor odd por outcome e overround por casa ─────────

  /** Ordem de exibição dos mercados (corresponde ao catálogo do seed). */
  const MARKET_ORDER = ["1x2", "double_chance", "dnb", "ou", "ah", "btts", "team_totals"];

  const markets = [...marketMap.entries()]
    .sort(([a], [b]) => {
      const ia = MARKET_ORDER.findIndex((m) => a.startsWith(m));
      const ib = MARKET_ORDER.findIndex((m) => b.startsWith(m));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([key, entry]) => {
      const outcomes = [...entry.outcomes.values()]
        .sort(
          (a, b) =>
            (a.outcome.display_order ?? 99) - (b.outcome.display_order ?? 99),
        )
        .map((o) => {
          // Encontrar a melhor odd (maior decimal_odds) deste outcome
          let bestOdds = 0;
          let bestBookmakerId: string | null = null;

          for (const bk of o.bookmakers) {
            if (bk.decimalOdds > bestOdds) {
              bestOdds = bk.decimalOdds;
              bestBookmakerId = bk.bookmaker.id;
            }
          }

          return {
            id: o.outcome.id,
            code: o.outcome.code,
            name: o.outcome.name_pt || o.outcome.name,
            line: o.outcome.line,
            bestOdds,
            bestBookmakerId,
            odds: o.bookmakers.map((bk) => ({
              bookmakerId: bk.bookmaker.id,
              decimalOdds: bk.decimalOdds,
              impliedProbability: bk.impliedProbability,
              previousOdds: bk.previousOdds,
              changeCount: bk.changeCount,
              lastUpdatedAt: bk.lastUpdatedAt,
              isBest: bk.bookmaker.id === bestBookmakerId,
            })),
          };
        });

      return {
        code: entry.market.code,
        name: entry.market.name_pt || entry.market.name,
        category: entry.market.category,
        hasLine: entry.market.has_line,
        key,
        outcomes,
      };
    });

  // Calcular overround por casa para o mercado 1x2
  const overrounds: Record<string, number> = {};
  const m1x2 = markets.find((m) => m.code === "1x2");
  if (m1x2 && m1x2.outcomes.length === 3) {
    // Para cada casa que tem as 3 odds (home, draw, away)
    for (const [bkId] of bookmakerSet) {
      const oddsForBk = m1x2.outcomes
        .map((o) => o.odds.find((od) => od.bookmakerId === bkId))
        .filter(Boolean);

      if (oddsForBk.length === 3) {
        const impliedSum = oddsForBk.reduce(
          (sum, od) => sum + 1 / od!.decimalOdds,
          0,
        );
        overrounds[bkId] = +(impliedSum - 1).toFixed(4);
      }
    }
  }

  // ─── Resposta ─────────────────────────────────────────────────────

  const bookmakers = [...bookmakerSet.values()].map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    spaAuthorized: b.spa_authorized,
    spaCompany: b.spa_company || null,
    spaAuthorization: b.spa_authorization || null,
    overround1x2: overrounds[b.id] ?? null,
  }));

  return NextResponse.json({
    event: {
      id: event.id,
      kickoffAt: event.kickoff_at,
      status: event.status,
      homeScore: event.home_score,
      awayScore: event.away_score,
      round: event.round,
      venueName: event.venue_name,
      homeTeam: event.home_team,
      awayTeam: event.away_team,
      league: event.league,
    },
    bookmakers,
    markets,
  });
}
