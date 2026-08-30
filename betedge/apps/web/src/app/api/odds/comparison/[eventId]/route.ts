/**
 * GET /api/odds/comparison/[eventId]
 *
 * Retorna todas as odds atuais de um evento, agrupadas por mercado e resultado,
 * com dados das casas de apostas (nome, slug, status SPA) e o destaque da
 * melhor odd de cada seleção. Dados estruturais vêm da tabela `odds` (Supabase).
 *
 * Fair probabilities e overround vêm do Python Engine (fonte canônica).
 * Quando o engine está indisponível, fair probs e overround são null.
 *
 * NOTA: Cálculos quantitativos (Shin, power, multiplicative) foram REMOVIDOS
 * deste arquivo. Python é a única fonte de toda matemática quantitativa.
 * Ver: PYTHON_TS_CONVERGENCE_REPORT.md
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════
// Helper — tentativa de proxy para o engine Python
// ═══════════════════════════════════════════════════════════════════════

async function tryEngine(path: string): Promise<Response | null> {
  const engineUrl = process.env.ENGINE_URL;
  if (!engineUrl) return null;

  try {
    const res = await fetch(`${engineUrl}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return res;
    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Tipo do response do Python Engine /api/odds/comparison/{event_id}/{market}
// ═══════════════════════════════════════════════════════════════════════

interface EngineFairProbs {
  bookmaker: string;
  outcomes: string[];
  decimal_odds: number[];
  implied_probabilities: number[];
  overround_pct: number;
  fair_probs: {
    multiplicative: Record<string, number>;
    power: Record<string, number>;
    shin: Record<string, number>;
  };
}

interface EngineComparisonResponse {
  by_bookmaker: EngineFairProbs[];
  best_odds: Record<string, number>;
}

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

  const marketMap = new Map<
    string,
    {
      market: (typeof oddsRows)[number]["market"];
      marketCode: string;
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

  const bookmakerSet = new Map<
    string,
    (typeof oddsRows)[number]["bookmaker"]
  >();

  for (const row of oddsRows ?? []) {
    if (!row.market || !row.outcome || !row.bookmaker) continue;

    const mCode = row.market.code + (row.outcome.line != null ? `_${row.outcome.line}` : "");
    if (!marketMap.has(mCode)) {
      marketMap.set(mCode, { market: row.market, marketCode: row.market.code, outcomes: new Map() });
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

  // ─── Buscar fair probs e overround do Python Engine ───────────────
  // Fair probs são computadas exclusivamente pelo Python (fonte canônica).
  // Indexadas por (marketCode, bookmakerName, outcomeCode) para merge.

  // Cache de fair probs do engine: marketCode → bookmakerName → outcomeCode → {mult, power, shin}
  const engineFairProbs = new Map<string, Map<string, Map<string, { multiplicative: number; power: number; shin: number }>>>();
  // Cache de overround: marketCode → bookmakerName → overround_pct
  const engineOverrounds = new Map<string, Map<string, number>>();

  // Buscar do engine para cada mercado
  const marketCodes = new Set([...marketMap.values()].map((m) => m.marketCode));
  for (const mc of marketCodes) {
    const engineRes = await tryEngine(`/api/odds/comparison/${eventId}/${mc}`);
    if (!engineRes) continue;

    try {
      const engineData: EngineComparisonResponse = await engineRes.json();
      const fpByBk = new Map<string, Map<string, { multiplicative: number; power: number; shin: number }>>();
      const orByBk = new Map<string, number>();

      for (const bk of engineData.by_bookmaker) {
        const outcomeMap = new Map<string, { multiplicative: number; power: number; shin: number }>();
        for (const oc of bk.outcomes) {
          outcomeMap.set(oc, {
            multiplicative: bk.fair_probs.multiplicative[oc] ?? 0,
            power: bk.fair_probs.power[oc] ?? 0,
            shin: bk.fair_probs.shin[oc] ?? 0,
          });
        }
        fpByBk.set(bk.bookmaker, outcomeMap);
        orByBk.set(bk.bookmaker, bk.overround_pct / 100); // converter pct → fração
      }
      engineFairProbs.set(mc, fpByBk);
      engineOverrounds.set(mc, orByBk);
    } catch {
      // Parse error — continua sem fair probs para este mercado
    }
  }

  // ─── Montar resposta ──────────────────────────────────────────────

  const MARKET_ORDER = ["1x2", "double_chance", "dnb", "ou", "ah", "btts", "team_totals"];

  const markets = [...marketMap.entries()]
    .sort(([a], [b]) => {
      const ia = MARKET_ORDER.findIndex((m) => a.startsWith(m));
      const ib = MARKET_ORDER.findIndex((m) => b.startsWith(m));
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([key, entry]) => {
      const outcomeEntries = [...entry.outcomes.values()].sort(
        (a, b) => (a.outcome.display_order ?? 99) - (b.outcome.display_order ?? 99),
      );

      // Fair probs do engine para este mercado
      const mFairProbs = engineFairProbs.get(entry.marketCode);
      const mOverrounds = engineOverrounds.get(entry.marketCode);

      const outcomes = outcomeEntries.map((o) => {
        const oCode = o.outcome.code + (o.outcome.line != null ? `_${o.outcome.line}` : "");

        // Melhor odd (maior decimal_odds) deste outcome
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
          odds: o.bookmakers.map((bk) => {
            // Fair probs do engine (Python canônico) — match por bookmaker name
            const bkFairProbs = mFairProbs?.get(bk.bookmaker.name);
            // O engine retorna outcome codes que podem diferir do oCode (ex.: sem _line)
            // Tentar match exato pelo oCode, fallback pelo outcome.code puro
            const fairProbs = bkFairProbs?.get(oCode) ?? bkFairProbs?.get(o.outcome.code) ?? null;

            return {
              bookmakerId: bk.bookmaker.id,
              decimalOdds: bk.decimalOdds,
              impliedProbability: bk.impliedProbability,
              previousOdds: bk.previousOdds,
              changeCount: bk.changeCount,
              lastUpdatedAt: bk.lastUpdatedAt,
              isBest: bk.bookmaker.id === bestBookmakerId,
              // Fair probs do Python (fonte canônica) — null se engine indisponível
              fairProb: fairProbs
                ? {
                    multiplicative: +fairProbs.multiplicative.toFixed(6),
                    power: +fairProbs.power.toFixed(6),
                    shin: +fairProbs.shin.toFixed(6),
                  }
                : null,
            };
          }),
        };
      });

      // Overround do engine por casa — null se engine indisponível
      const marketOverrounds: Record<string, number | null> = {};
      for (const [, oEntry] of entry.outcomes) {
        for (const bk of oEntry.bookmakers) {
          if (!(bk.bookmaker.id in marketOverrounds)) {
            const or = mOverrounds?.get(bk.bookmaker.name) ?? null;
            marketOverrounds[bk.bookmaker.id] = or != null ? +or.toFixed(4) : null;
          }
        }
      }

      return {
        code: entry.market.code,
        name: entry.market.name_pt || entry.market.name,
        category: entry.market.category,
        hasLine: entry.market.has_line,
        key,
        outcomes,
        overrounds: marketOverrounds,
      };
    });

  // Overround por casa para o mercado 1x2 (para a barra de bookmakers)
  const overrounds1x2: Record<string, number | null> = {};
  const m1x2 = markets.find((m) => m.code === "1x2");
  if (m1x2) {
    for (const [bkId, or] of Object.entries(m1x2.overrounds)) {
      overrounds1x2[bkId] = or;
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
    overround1x2: overrounds1x2[b.id] ?? null,
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
