/**
 * GET /api/model-audit
 *
 * Retorna dados de auditoria do pipeline de previsões:
 * eventos com odds, probabilidades justas e previsões dos modelos,
 * permitindo rastrear cada valor exibido no dashboard até a fonte.
 *
 * Query params:
 *   status   — "scheduled" | "finished" | "all" (padrão "all")
 *   leagueId — UUID de liga para filtrar
 *   limit    — quantidade de eventos (padrão 50, máx 200)
 *   offset   — paginação
 *   search   — busca por nome de time
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ═══════════════════════════════════════════════════════════════════════
// Tipos de resposta
// ═══════════════════════════════════════════════════════════════════════

interface BookmakerOdd {
  bookmakerName: string;
  odds: number;
  impliedProbability: number;
  timestamp: string;
}

interface ModelPrediction {
  modelName: string;
  modelVersion: string;
  modelType: string;
  probability: number;
  fairOdds: number;
  predictedAt: string;
  featuresSnapshot: Record<string, unknown> | null;
}

interface OutcomeAudit {
  outcomeName: string;
  bookmakers: BookmakerOdd[];
  overround: number;
  fairProbability: number | null;
  modelPredictions: ModelPrediction[];
  edge: number | null;
  ev: number | null;
  prediqIndex: number | null;
}

interface MarketAudit {
  marketName: string;
  outcomes: OutcomeAudit[];
}

interface EventAudit {
  event: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    leagueId: string;
    kickoffAt: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
  };
  markets: MarketAudit[];
}

interface AuditSummary {
  totalEvents: number;
  totalPredictions: number;
  activeModels: number;
  coverage: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Remoção de vig — Shin (1992)
// Inline para evitar import do workspace no runtime do edge.
// ═══════════════════════════════════════════════════════════════════════

function removeVigShin(impliedProbs: number[]): number[] {
  if (impliedProbs.length < 2 || impliedProbs.some((p) => p <= 0)) {
    const total = impliedProbs.reduce((s, p) => s + p, 0);
    return total > 0 ? impliedProbs.map((p) => p / total) : impliedProbs;
  }
  const s = impliedProbs.reduce((sum, p) => sum + p, 0);
  if (s <= 1.0) {
    return impliedProbs.map((p) => p / s);
  }

  const probsAt = (z: number): number[] => {
    if (z <= 0) {
      const sqrtS = Math.sqrt(s);
      return impliedProbs.map((p) => p / sqrtS);
    }
    const denom = 2.0 * (1.0 - z);
    return impliedProbs.map(
      (p) => (Math.sqrt(z * z + (4.0 * (1.0 - z) * p * p) / s) - z) / denom,
    );
  };
  const totalAt = (z: number) => probsAt(z).reduce((sum, p) => sum + p, 0);

  let lo = 0.0,
    hi = 1.0 - 1e-9;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2.0;
    if (totalAt(mid) > 1.0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  const probs = probsAt((lo + hi) / 2.0);
  const total = probs.reduce((sum, p) => sum + p, 0);
  return probs.map((p) => p / total);
}

// ═══════════════════════════════════════════════════════════════════════
// Handler GET
// ═══════════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? "all";
  const leagueId = searchParams.get("leagueId");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const offset = Number(searchParams.get("offset") ?? 0);
  const search = searchParams.get("search")?.trim().toLowerCase();

  const supabase = await createClient();

  // ─── 1. Buscar eventos ──────────────────────────────────────────────

  let eventsQuery = supabase
    .from("events")
    .select(
      `
      id,
      kickoff_at,
      status,
      home_score,
      away_score,
      home_team:teams!home_team_id ( id, name, short_name ),
      away_team:teams!away_team_id ( id, name, short_name ),
      league:leagues!league_id ( id, name, short_name, country_code )
    `,
      { count: "exact" },
    )
    .order("kickoff_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status === "scheduled") {
    eventsQuery = eventsQuery.in("status", ["scheduled", "live"]);
  } else if (status === "finished") {
    eventsQuery = eventsQuery.eq("status", "finished");
  }

  if (leagueId) {
    eventsQuery = eventsQuery.eq("league_id", leagueId);
  }

  const { data: eventsRaw, error: eventsError, count: totalEvents } = await eventsQuery;

  if (eventsError) {
    return NextResponse.json(
      { error: "Falha ao buscar eventos", detail: eventsError.message },
      { status: 500 },
    );
  }

  // Filtro por nome de time (pós-query, pois Supabase não suporta ILIKE
  // facilmente em colunas de join)
  type EventRow = Record<string, unknown>;
  let events: EventRow[] = eventsRaw ?? [];
  if (search) {
    events = events.filter((e) => {
      const home = e.home_team as { name: string } | null;
      const away = e.away_team as { name: string } | null;
      return (
        (home?.name?.toLowerCase().includes(search) ?? false) ||
        (away?.name?.toLowerCase().includes(search) ?? false)
      );
    });
  }

  const eventIds = events.map((e) => e.id as string);

  // ─── 2. Buscar odds dos eventos ──────────────────────────────────────

  let oddsRows: EventRow[] = [];
  if (eventIds.length > 0) {
    const { data, error: oddsError } = await supabase
      .from("odds")
      .select(
        `
        id,
        event_id,
        decimal_odds,
        implied_probability,
        last_updated_at,
        bookmaker:bookmakers!bookmaker_id ( id, name, slug ),
        market:markets!market_id ( id, code, name, name_pt, category ),
        outcome:outcomes!outcome_id ( id, code, name, name_pt, line, display_order )
      `,
      )
      .in("event_id", eventIds)
      .eq("is_suspended", false);

    if (!oddsError && data) {
      oddsRows = data as EventRow[];
    }
  }

  // ─── 3. Buscar previsões dos modelos ─────────────────────────────────

  let predictionsRows: EventRow[] = [];
  if (eventIds.length > 0) {
    const { data, error: predsError } = await supabase
      .from("model_predictions")
      .select(
        `
        id,
        event_id,
        market_id,
        outcome_id,
        probability,
        predicted_at,
        features_snapshot,
        model_version:model_versions!model_version_id (
          id, model_name, version, model_type
        )
      `,
      )
      .in("event_id", eventIds);

    if (!predsError && data) {
      predictionsRows = data as EventRow[];
    }
  }

  // ─── 4. Tentar buscar da materialized view de fair probs ─────────────

  const fairProbsMap = new Map<string, number>();
  let usedMV = false;

  if (eventIds.length > 0) {
    const { data: fairData, error: fairError } = await supabase
      .from("mv_fair_probabilities")
      .select("event_id, market_code, outcome_code, fair_probability")
      .in("event_id", eventIds);

    if (!fairError && fairData && fairData.length > 0) {
      usedMV = true;
      for (const row of fairData) {
        const r = row as EventRow;
        const key = `${r.event_id}:${r.market_code}:${r.outcome_code}`;
        fairProbsMap.set(key, Number(r.fair_probability));
      }
    }
  }

  // ─── 5. Buscar value_opportunities para Índice PREDIQ ────────────────

  const prediqMap = new Map<string, number>();
  if (eventIds.length > 0) {
    const { data: voData, error: voError } = await supabase
      .from("value_opportunities")
      .select("event_id, outcome_id, prediq_index")
      .in("event_id", eventIds);

    if (!voError && voData) {
      for (const row of voData) {
        const r = row as EventRow;
        if (r.prediq_index != null) {
          prediqMap.set(`${r.event_id}:${r.outcome_id}`, Number(r.prediq_index));
        }
      }
    }
  }

  // ─── 6. Lista de ligas para o dropdown de filtro ─────────────────────

  const { data: leaguesData } = await supabase
    .from("leagues")
    .select("id, name")
    .order("name");

  const leagues = (leaguesData ?? []).map((l: EventRow) => ({
    id: l.id as string,
    name: l.name as string,
  }));

  // ─── 7. Montar resposta agrupada ────────────────────────────────────

  // Indexar odds por evento
  const oddsByEvent = new Map<string, EventRow[]>();
  for (const row of oddsRows) {
    const eid = row.event_id as string;
    if (!oddsByEvent.has(eid)) oddsByEvent.set(eid, []);
    oddsByEvent.get(eid)!.push(row);
  }

  // Indexar previsões por evento+outcome
  const predsByEventOutcome = new Map<string, EventRow[]>();
  for (const row of predictionsRows) {
    const key = `${row.event_id}:${row.outcome_id}`;
    if (!predsByEventOutcome.has(key)) predsByEventOutcome.set(key, []);
    predsByEventOutcome.get(key)!.push(row);
  }

  // Contadores para o resumo
  const totalPredictions = predictionsRows.length;
  const modelNamesSet = new Set<string>();
  for (const pred of predictionsRows) {
    const mv = pred.model_version as { model_name: string; version: string } | null;
    if (mv?.model_name) modelNamesSet.add(`${mv.model_name}:${mv.version}`);
  }

  let eventsWithPredictions = 0;

  const auditEvents: EventAudit[] = events.map((ev) => {
    const home = ev.home_team as { name: string } | null;
    const away = ev.away_team as { name: string } | null;
    const league = ev.league as { id: string; name: string } | null;

    const eventOdds = oddsByEvent.get(ev.id as string) ?? [];

    // Agrupar odds por mercado → outcome
    const marketMap = new Map<
      string,
      {
        marketName: string;
        marketCode: string;
        outcomes: Map<
          string,
          {
            outcomeName: string;
            outcomeId: string;
            outcomeCode: string;
            bookmakers: BookmakerOdd[];
            impliedProbs: number[];
          }
        >;
      }
    >();

    for (const odd of eventOdds) {
      const market = odd.market as { code: string; name: string; name_pt: string } | null;
      const outcome = odd.outcome as { id: string; code: string; name: string; name_pt: string; line: number | null } | null;
      const bookmaker = odd.bookmaker as { name: string } | null;

      if (!market || !outcome || !bookmaker) continue;

      const mKey = market.code + (outcome.line != null ? `_${outcome.line}` : "");
      if (!marketMap.has(mKey)) {
        marketMap.set(mKey, {
          marketName: market.name_pt || market.name,
          marketCode: market.code,
          outcomes: new Map(),
        });
      }

      const oKey = outcome.code + (outcome.line != null ? `_${outcome.line}` : "");
      const mEntry = marketMap.get(mKey)!;
      if (!mEntry.outcomes.has(oKey)) {
        mEntry.outcomes.set(oKey, {
          outcomeName: outcome.name_pt || outcome.name,
          outcomeId: outcome.id,
          outcomeCode: outcome.code,
          bookmakers: [],
          impliedProbs: [],
        });
      }

      const decimalOdds = Number(odd.decimal_odds);
      const impliedProb = decimalOdds > 0 ? 1 / decimalOdds : 0;

      mEntry.outcomes.get(oKey)!.bookmakers.push({
        bookmakerName: bookmaker.name,
        odds: decimalOdds,
        impliedProbability: impliedProb,
        timestamp: (odd.last_updated_at as string) ?? "",
      });
      mEntry.outcomes.get(oKey)!.impliedProbs.push(impliedProb);
    }

    // Verificar se o evento possui previsões
    let eventHasPredictions = false;

    const markets: MarketAudit[] = [...marketMap.entries()].map(([, mEntry]) => {
      const allOutcomes = [...mEntry.outcomes.values()];

      // Média das prob. implícitas por outcome (entre casas)
      const avgImpliedProbs = allOutcomes.map((o) => {
        if (o.impliedProbs.length === 0) return 0;
        return o.impliedProbs.reduce((s, p) => s + p, 0) / o.impliedProbs.length;
      });

      // Fair probs via Shin (inline) caso a MV não esteja disponível
      const shinFairProbs = !usedMV ? removeVigShin(avgImpliedProbs) : [];

      const outcomes: OutcomeAudit[] = allOutcomes.map((o, idx) => {
        const overround = avgImpliedProbs.reduce((s, p) => s + p, 0);

        // Fair probability — da MV ou calculada inline
        let fairProb: number | null = null;
        const mvKey = `${ev.id}:${mEntry.marketCode}:${o.outcomeCode}`;
        if (usedMV && fairProbsMap.has(mvKey)) {
          fairProb = fairProbsMap.get(mvKey)!;
        } else if (shinFairProbs.length > idx) {
          fairProb = shinFairProbs[idx];
        }

        // Previsões dos modelos
        const predsKey = `${ev.id}:${o.outcomeId}`;
        const preds = predsByEventOutcome.get(predsKey) ?? [];
        const modelPredictions: ModelPrediction[] = preds.map((p) => {
          const mv = p.model_version as { model_name: string; version: string; model_type: string } | null;
          const probability = Number(p.probability);
          return {
            modelName: mv?.model_name ?? "Desconhecido",
            modelVersion: mv?.version ?? "?",
            modelType: mv?.model_type ?? "unknown",
            probability,
            fairOdds: probability > 0 ? +(1 / probability).toFixed(2) : 0,
            predictedAt: (p.predicted_at as string) ?? "",
            featuresSnapshot: (p.features_snapshot as Record<string, unknown>) ?? null,
          };
        });

        if (modelPredictions.length > 0) eventHasPredictions = true;

        // Edge e EV — usa a primeira previsão disponível
        const primaryPred = modelPredictions[0] ?? null;
        let edge: number | null = null;
        let expectedValue: number | null = null;

        if (primaryPred && fairProb && fairProb > 0) {
          edge = (primaryPred.probability - fairProb) / fairProb;
        }

        const bestOdds = o.bookmakers.reduce(
          (best, bk) => (bk.odds > best ? bk.odds : best),
          0,
        );
        if (primaryPred && bestOdds > 0) {
          expectedValue = primaryPred.probability * bestOdds - 1;
        }

        // Índice PREDIQ
        const prediqIndex = prediqMap.get(`${ev.id}:${o.outcomeId}`) ?? null;

        return {
          outcomeName: o.outcomeName,
          bookmakers: o.bookmakers,
          overround: +overround.toFixed(4),
          fairProbability: fairProb != null ? +fairProb.toFixed(6) : null,
          modelPredictions,
          edge: edge != null ? +edge.toFixed(6) : null,
          ev: expectedValue != null ? +expectedValue.toFixed(6) : null,
          prediqIndex,
        };
      });

      return { marketName: mEntry.marketName, outcomes };
    });

    if (eventHasPredictions) eventsWithPredictions++;

    return {
      event: {
        id: ev.id as string,
        homeTeam: home?.name ?? "?",
        awayTeam: away?.name ?? "?",
        league: league?.name ?? "?",
        leagueId: league?.id ?? "",
        kickoffAt: ev.kickoff_at as string,
        status: ev.status as string,
        homeScore: (ev.home_score as number) ?? null,
        awayScore: (ev.away_score as number) ?? null,
      },
      markets,
    };
  });

  const summary: AuditSummary = {
    totalEvents: totalEvents ?? events.length,
    totalPredictions,
    activeModels: modelNamesSet.size,
    coverage:
      events.length > 0
        ? +(eventsWithPredictions / events.length).toFixed(4)
        : 0,
  };

  return NextResponse.json({ events: auditEvents, summary, leagues });
}
