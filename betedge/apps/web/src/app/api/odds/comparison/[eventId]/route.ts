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

  // ─── Calcular melhor odd, fair probs (sem vig) e overround ─────────

  /** Ordem de exibição dos mercados (corresponde ao catálogo do seed). */
  const MARKET_ORDER = ["1x2", "double_chance", "dnb", "ou", "ah", "btts", "team_totals"];

  /**
   * Remoção de vig — normalização multiplicativa (a mesma fórmula de
   * @betedge/utils, inline para evitar import de workspace no runtime).
   * Recebe probabilidades implícitas (com vig), retorna prob. justas que somam 1.
   */
  function removeVigMultiplicative(impliedProbs: number[]): number[] {
    const total = impliedProbs.reduce((s, p) => s + p, 0);
    return total > 0 ? impliedProbs.map((p) => p / total) : impliedProbs;
  }

  /**
   * Remoção de vig — método da potência. Resolve k tal que sum(pi_i^k) = 1
   * por busca binária. Corrige melhor o viés favorito/azarão.
   */
  function removeVigPower(impliedProbs: number[]): number[] {
    if (impliedProbs.some((p) => p <= 0 || p >= 1)) {
      return removeVigMultiplicative(impliedProbs);
    }
    const totalAt = (k: number) => impliedProbs.reduce((s, p) => s + p ** k, 0);
    if (Math.abs(totalAt(1.0) - 1.0) < 1e-10) {
      return removeVigMultiplicative(impliedProbs);
    }
    let lo = 1.0, hi = 2.0;
    while (totalAt(hi) > 1.0 && hi < 1e6) hi *= 2.0;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2.0;
      if (totalAt(mid) > 1.0) lo = mid; else hi = mid;
      if (hi - lo < 1e-10) break;
    }
    const k = (lo + hi) / 2.0;
    const probs = impliedProbs.map((p) => p ** k);
    const s = probs.reduce((sum, p) => sum + p, 0);
    return probs.map((p) => p / s);
  }

  /**
   * Remoção de vig — método de Shin (1992). Modela fração de insider trading.
   * Mais preciso para mercados com forte assimetria favorito/azarão.
   */
  function removeVigShin(impliedProbs: number[]): number[] {
    if (impliedProbs.some((p) => p <= 0)) {
      return removeVigMultiplicative(impliedProbs);
    }
    const s = impliedProbs.reduce((sum, p) => sum + p, 0);
    if (s <= 1.0) return removeVigMultiplicative(impliedProbs);

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

    let lo = 0.0, hi = 1.0 - 1e-9;
    if (totalAt(hi) > 1.0) {
      /* overround extremo — melhor esforço */
    } else {
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2.0;
        if (totalAt(mid) > 1.0) lo = mid; else hi = mid;
        if (hi - lo < 1e-12) break;
      }
    }
    const probs = probsAt((lo + hi) / 2.0);
    const total = probs.reduce((sum, p) => sum + p, 0);
    return probs.map((p) => p / total);
  }

  /** Escolhe o método de remoção de vig. */
  type VigMethod = "multiplicative" | "power" | "shin";
  function removeVig(impliedProbs: number[], method: VigMethod = "multiplicative"): number[] {
    switch (method) {
      case "power": return removeVigPower(impliedProbs);
      case "shin": return removeVigShin(impliedProbs);
      default: return removeVigMultiplicative(impliedProbs);
    }
  }

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

      // ── Calcular fair probs (sem vig) por casa ──
      // Para cada casa, coletamos as odds de todos os outcomes deste mercado,
      // removemos o vig, e distribuímos as probabilidades justas de volta.
      const fairProbsByBookmaker = new Map<string, Map<string, { multiplicative: number; power: number; shin: number }>>();

      // Agrupar odds por bookmaker dentro deste mercado
      const oddsByBookmaker = new Map<string, { outcomeCode: string; decimalOdds: number }[]>();
      for (const o of outcomeEntries) {
        const oCode = o.outcome.code + (o.outcome.line != null ? `_${o.outcome.line}` : "");
        for (const bk of o.bookmakers) {
          if (!oddsByBookmaker.has(bk.bookmaker.id)) oddsByBookmaker.set(bk.bookmaker.id, []);
          oddsByBookmaker.get(bk.bookmaker.id)!.push({ outcomeCode: oCode, decimalOdds: bk.decimalOdds });
        }
      }

      // Calcular fair probs por casa com os 3 métodos
      for (const [bkId, bkOdds] of oddsByBookmaker) {
        if (bkOdds.length < 2) continue; // precisa de ao menos 2 outcomes p/ remover vig
        const impliedProbs = bkOdds.map((o) => 1 / o.decimalOdds);
        const fairMult = removeVig(impliedProbs, "multiplicative");
        const fairPow = removeVig(impliedProbs, "power");
        const fairSh = removeVig(impliedProbs, "shin");

        const bkMap = new Map<string, { multiplicative: number; power: number; shin: number }>();
        for (let i = 0; i < bkOdds.length; i++) {
          bkMap.set(bkOdds[i].outcomeCode, {
            multiplicative: fairMult[i],
            power: fairPow[i],
            shin: fairSh[i],
          });
        }
        fairProbsByBookmaker.set(bkId, bkMap);
      }

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
            const fairProbs = fairProbsByBookmaker.get(bk.bookmaker.id)?.get(oCode);
            return {
              bookmakerId: bk.bookmaker.id,
              decimalOdds: bk.decimalOdds,
              impliedProbability: bk.impliedProbability,
              previousOdds: bk.previousOdds,
              changeCount: bk.changeCount,
              lastUpdatedAt: bk.lastUpdatedAt,
              isBest: bk.bookmaker.id === bestBookmakerId,
              // Probabilidades justas (sem vig) pelos 3 métodos
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

      // Overround deste mercado por casa
      const marketOverrounds: Record<string, number> = {};
      for (const [bkId, bkOdds] of oddsByBookmaker) {
        const impliedSum = bkOdds.reduce((s, o) => s + 1 / o.decimalOdds, 0);
        marketOverrounds[bkId] = +(impliedSum - 1).toFixed(4);
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
  const overrounds1x2: Record<string, number> = {};
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
