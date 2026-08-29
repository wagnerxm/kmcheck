/**
 * GET /api/shadow-lab
 *
 * API route para o dashboard Shadow Lab — validacao prospectiva.
 * Suporta multiplas views via query param `view`:
 *   - overview     — KPIs, criterios de graduacao, metricas resumo
 *   - predictions  — lista paginada de previsoes shadow
 *   - metrics      — metricas agregadas por dimensao (group_by)
 *   - calibration  — bins de calibracao e ECE por liga
 *   - equity-curve — evolucao do bankroll simulado
 *
 * Abordagem dual: tenta buscar do engine API (ENGINE_URL), senao
 * consulta diretamente o Supabase como fallback.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Tipo generico para linhas retornadas pelo Supabase (schema dinamico)
type ShadowRow = Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════════
// Helper — tentativa de proxy para o engine
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
    // Engine indisponivel — fallback para Supabase
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Helper — verifica se a tabela existe (evita erros 404 no Supabase)
// ═══════════════════════════════════════════════════════════════════════

async function tableExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .limit(0);
    // Se a tabela nao existe, Supabase retorna 404 ou erro com "relation"
    return !error;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Resposta vazia para quando nao ha dados
// ═══════════════════════════════════════════════════════════════════════

function emptyOverview() {
  return {
    totalPredictions: 0,
    openPredictions: 0,
    gradedPredictions: 0,
    hitRate: null,
    roiTheoretical: null,
    brierScore: null,
    logLoss: null,
    ece: null,
    clvMean: null,
    maxDrawdown: null,
    sampleSize: 0,
    graduationCriteria: {
      events200: { current: 0, target: 200, met: false },
      bets500: { current: 0, target: 500, met: false },
      ece3Leagues: { leagues: [] as string[], met: false },
      clvPositive: { value: null, met: false },
      noLeakage: { met: true },
      pythonTsConvergence: { met: false },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Helper — mapeia view para o endpoint correto do engine
// ═══════════════════════════════════════════════════════════════════════

function buildEnginePath(view: string, params: URLSearchParams): string {
  switch (view) {
    case "overview":
      return "/api/shadow/overview";
    case "predictions": {
      const pp = new URLSearchParams();
      if (params.get("status")) pp.set("status", params.get("status")!);
      if (params.get("league")) pp.set("league", params.get("league")!);
      if (params.get("limit")) pp.set("limit", params.get("limit")!);
      if (params.get("offset")) pp.set("offset", params.get("offset")!);
      const qs = pp.toString();
      return `/api/shadow/predictions${qs ? `?${qs}` : ""}`;
    }
    case "metrics": {
      const gb = params.get("group_by");
      return `/api/shadow/metrics${gb ? `?group_by=${gb}` : ""}`;
    }
    case "calibration":
      return "/api/shadow/calibration";
    case "equity-curve":
      return "/api/shadow/equity-curve";
    default:
      return `/api/shadow/${view}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Handler GET
// ═══════════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const view = searchParams.get("view") ?? "overview";

  // ─── Tentar engine primeiro ─────────────────────────────────────────
  const enginePath = buildEnginePath(view, searchParams);
  const engineRes = await tryEngine(enginePath);
  if (engineRes) {
    const data = await engineRes.json();
    return NextResponse.json(data);
  }

  // ─── Fallback: Supabase direto ──────────────────────────────────────
  const supabase = await createClient();
  const hasShadow = await tableExists(supabase, "shadow_predictions");

  try {
    switch (view) {
      case "overview":
        return NextResponse.json(await handleOverview(supabase, hasShadow));
      case "predictions":
        return NextResponse.json(
          await handlePredictions(supabase, hasShadow, searchParams),
        );
      case "metrics":
        return NextResponse.json(
          await handleMetrics(supabase, hasShadow, searchParams),
        );
      case "calibration":
        return NextResponse.json(
          await handleCalibration(supabase, hasShadow),
        );
      case "equity-curve":
        return NextResponse.json(
          await handleEquityCurve(supabase, hasShadow),
        );
      default:
        return NextResponse.json(
          { error: `View desconhecida: ${view}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("[shadow-lab]", err);
    return NextResponse.json(
      { error: "Erro interno ao processar dados do Shadow Lab" },
      { status: 500 },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// View: overview
// ═══════════════════════════════════════════════════════════════════════

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function handleOverview(
  supabase: SupabaseClient,
  hasShadow: boolean,
) {
  if (!hasShadow) return emptyOverview();

  // Contagens basicas
  const { count: total } = await supabase
    .from("shadow_predictions")
    .select("*", { count: "exact", head: true });

  const { count: open } = await supabase
    .from("shadow_predictions")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  const { count: graded } = await supabase
    .from("shadow_predictions")
    .select("*", { count: "exact", head: true })
    .eq("status", "graded");

  // Buscar previsoes resolvidas para calcular metricas
  const { data: resolved } = await supabase
    .from("shadow_predictions")
    .select(
      "result, model_probability, fair_market_probability, best_odds, edge, ev, clv, prediq_score, league",
    )
    .eq("status", "graded")
    .in("result", ["won", "lost"]);

  const rows: ShadowRow[] = resolved ?? [];
  const n = rows.length;

  let hitRate: number | null = null;
  let roiTheoretical: number | null = null;
  let brierScore: number | null = null;
  let logLoss: number | null = null;
  let clvMean: number | null = null;

  if (n > 0) {
    // hit rate
    const wins = rows.filter((r) => r.result === "won").length;
    hitRate = wins / n;

    // ROI teorico — soma dos EV / N
    const evSum = rows.reduce(
      (s, r) => s + (r.ev != null ? Number(r.ev) : 0),
      0,
    );
    roiTheoretical = evSum / n;

    // Brier Score — media de (prob - outcome)^2
    let brierSum = 0;
    for (const r of rows) {
      const p = r.model_probability != null ? Number(r.model_probability) : 0;
      const outcome = r.result === "won" ? 1 : 0;
      brierSum += (p - outcome) ** 2;
    }
    brierScore = brierSum / n;

    // Log Loss
    let llSum = 0;
    const eps = 1e-15;
    for (const r of rows) {
      const p = Math.max(eps, Math.min(1 - eps, Number(r.model_probability ?? 0.5)));
      const outcome = r.result === "won" ? 1 : 0;
      llSum += -(outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p));
    }
    logLoss = llSum / n;

    // CLV medio
    const clvs = rows
      .filter((r) => r.clv != null)
      .map((r) => Number(r.clv));
    clvMean = clvs.length > 0
      ? clvs.reduce((s, v) => s + v, 0) / clvs.length
      : null;
  }

  // ECE — agrupar em 10 bins
  let ece: number | null = null;
  if (n > 0) {
    const bins = Array.from({ length: 10 }, () => ({
      sumPred: 0,
      sumOutcome: 0,
      count: 0,
    }));
    for (const r of rows) {
      const p = Number(r.model_probability ?? 0.5);
      const idx = Math.min(Math.floor(p * 10), 9);
      bins[idx]!.sumPred += p;
      bins[idx]!.sumOutcome += r.result === "won" ? 1 : 0;
      bins[idx]!.count++;
    }
    let eceSum = 0;
    for (const b of bins) {
      if (b.count === 0) continue;
      eceSum +=
        (Math.abs(b.sumPred / b.count - b.sumOutcome / b.count) * b.count) / n;
    }
    ece = eceSum;
  }

  // Max drawdown — simulacao sequencial simplificada
  let maxDrawdown: number | null = null;
  if (n > 0) {
    let bankroll = 100;
    let peak = 100;
    let worstDd = 0;
    for (const r of rows) {
      const stake = 1; // aposta fixa 1 unidade
      if (r.result === "won") {
        bankroll += stake * (Number(r.best_odds ?? 2) - 1);
      } else {
        bankroll -= stake;
      }
      if (bankroll > peak) peak = bankroll;
      const dd = peak > 0 ? (peak - bankroll) / peak : 0;
      if (dd > worstDd) worstDd = dd;
    }
    maxDrawdown = worstDd;
  }

  // Criterios de graduacao
  // Eventos distintos
  const { data: distinctEvents } = await supabase
    .from("shadow_predictions")
    .select("event_id")
    .limit(1000);

  const uniqueEventIds = new Set(
    (distinctEvents ?? []).map((r: ShadowRow) => r.event_id),
  );
  const eventCount = uniqueEventIds.size;

  // Contar shadow selections graduadas para criterio bets500
  const { count: gradedSelections } = await supabase
    .from("shadow_predictions")
    .select("*", { count: "exact", head: true })
    .eq("is_shadow_selection", true)
    .eq("status", "graded");

  // ECE por liga — para criterio de 3 ligas com ECE < 0.05
  const leaguesWithGoodEce: string[] = [];
  if (n > 0) {
    const leagueMap = new Map<
      string,
      { sumPred: number; sumOutcome: number; count: number }[]
    >();
    for (const r of rows as ShadowRow[]) {
      const league = (r.league as string) ?? "unknown";
      if (!leagueMap.has(league)) {
        leagueMap.set(
          league,
          Array.from({ length: 10 }, () => ({
            sumPred: 0,
            sumOutcome: 0,
            count: 0,
          })),
        );
      }
      const bins = leagueMap.get(league)!;
      const p = Number(r.model_probability ?? 0.5);
      const idx = Math.min(Math.floor(p * 10), 9);
      bins[idx]!.sumPred += p;
      bins[idx]!.sumOutcome += r.result === "won" ? 1 : 0;
      bins[idx]!.count++;
    }

    for (const [league, bins] of leagueMap) {
      const totalInLeague = bins.reduce((s, b) => s + b.count, 0);
      if (totalInLeague < 30) continue; // amostra insuficiente
      let leagueEce = 0;
      for (const b of bins) {
        if (b.count === 0) continue;
        leagueEce +=
          (Math.abs(b.sumPred / b.count - b.sumOutcome / b.count) * b.count) /
          totalInLeague;
      }
      if (leagueEce < 0.05) leaguesWithGoodEce.push(league);
    }
  }

  return {
    totalPredictions: total ?? 0,
    openPredictions: open ?? 0,
    gradedPredictions: graded ?? 0,
    hitRate: hitRate != null ? +hitRate.toFixed(4) : null,
    roiTheoretical: roiTheoretical != null ? +roiTheoretical.toFixed(4) : null,
    brierScore: brierScore != null ? +brierScore.toFixed(4) : null,
    logLoss: logLoss != null ? +logLoss.toFixed(4) : null,
    ece: ece != null ? +ece.toFixed(4) : null,
    clvMean: clvMean != null ? +clvMean.toFixed(4) : null,
    maxDrawdown: maxDrawdown != null ? +maxDrawdown.toFixed(4) : null,
    sampleSize: n,
    graduationCriteria: {
      events200: {
        current: eventCount,
        target: 200,
        met: eventCount >= 200,
      },
      bets500: {
        current: gradedSelections ?? 0,
        target: 500,
        met: (gradedSelections ?? 0) >= 500,
      },
      ece3Leagues: {
        leagues: leaguesWithGoodEce,
        met: leaguesWithGoodEce.length >= 3,
      },
      clvPositive: {
        value: clvMean,
        met: clvMean != null && clvMean > 0,
      },
      noLeakage: { met: true }, // auditoria manual separada
      pythonTsConvergence: { met: false }, // requer verificacao cruzada
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// View: predictions
// ═══════════════════════════════════════════════════════════════════════

async function handlePredictions(
  supabase: SupabaseClient,
  hasShadow: boolean,
  params: URLSearchParams,
) {
  if (!hasShadow) {
    return { predictions: [], total: 0, leagues: [] };
  }

  const statusFilter = params.get("status") ?? "all";
  const leagueFilter = params.get("league");
  const search = params.get("search")?.trim().toLowerCase();
  const limit = Math.min(Number(params.get("limit") ?? 50), 200);
  const offset = Number(params.get("offset") ?? 0);

  let query = supabase
    .from("shadow_predictions")
    .select("*", { count: "exact" })
    .order("generated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  if (leagueFilter) {
    query = query.eq("league", leagueFilter);
  }

  const { data: rows, count } = await query;

  let predictions = ((rows ?? []) as ShadowRow[]).map((r) => ({
    id: r.id as string,
    eventName: `${r.home_team ?? "?"} vs ${r.away_team ?? "?"}`,
    homeTeam: (r.home_team as string) ?? "?",
    awayTeam: (r.away_team as string) ?? "?",
    league: (r.league as string) ?? "?",
    market: (r.market as string) ?? "?",
    outcome: (r.outcome as string) ?? "?",
    bestOdds: r.best_odds != null ? Number(r.best_odds) : null,
    fairProb: r.fair_market_probability != null ? Number(r.fair_market_probability) : null,
    modelProb: r.model_probability != null ? Number(r.model_probability) : null,
    edge: r.edge != null ? Number(r.edge) : null,
    ev: r.ev != null ? Number(r.ev) : null,
    prediqScore: r.prediq_score != null ? Number(r.prediq_score) : null,
    kelly: r.kelly_fraction != null ? Number(r.kelly_fraction) : null,
    status: (r.status as string) ?? "open",
    result: (r.result as string) ?? null,
    createdAt: (r.generated_at as string) ?? "",
    settledAt: (r.graded_at as string) ?? null,
  }));

  // Filtro de busca pos-query (time no nome)
  if (search) {
    predictions = predictions.filter(
      (p) =>
        p.homeTeam.toLowerCase().includes(search) ||
        p.awayTeam.toLowerCase().includes(search),
    );
  }

  // Ligas disponiveis para o dropdown
  const { data: leagueRows } = await supabase
    .from("shadow_predictions")
    .select("league")
    .limit(1000);

  const leagues = [
    ...new Set(((leagueRows ?? []) as ShadowRow[]).map((r) => r.league as string).filter(Boolean)),
  ].sort();

  return {
    predictions,
    total: count ?? predictions.length,
    leagues,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// View: metrics (agregadas por dimensao)
// ═══════════════════════════════════════════════════════════════════════

async function handleMetrics(
  supabase: SupabaseClient,
  hasShadow: boolean,
  params: URLSearchParams,
) {
  if (!hasShadow) return { rows: [] };

  const groupBy = params.get("group_by") ?? "league";

  // Buscar previsoes resolvidas
  const { data: resolved } = await supabase
    .from("shadow_predictions")
    .select(
      "result, model_probability, fair_market_probability, best_odds, edge, ev, clv, clv_price, clv_probability, prediq_score, league, market, outcome, generated_at, is_shadow_selection",
    )
    .not("result", "is", null)
    .in("result", ["won", "lost"]);

  const rows: ShadowRow[] = resolved ?? [];
  if (rows.length === 0) return { rows: [] };

  // Funcao para determinar a chave de agrupamento
  const getKey = (r: ShadowRow): string => {
    switch (groupBy) {
      case "league":
        return (r.league as string) ?? "Desconhecida";
      case "market":
        return (r.market as string) ?? "Desconhecido";
      case "model":
        return "Ensemble"; // tabela shadow nao separa modelos por enquanto
      case "odds_range": {
        const odds = Number(r.best_odds ?? 0);
        if (odds < 1.5) return "1.00–1.49";
        if (odds < 2.0) return "1.50–1.99";
        if (odds < 3.0) return "2.00–2.99";
        if (odds < 5.0) return "3.00–4.99";
        return "5.00+";
      }
      case "edge_range": {
        const edge = Number(r.edge ?? 0);
        if (edge < 0) return "< 0%";
        if (edge < 0.02) return "0–2%";
        if (edge < 0.05) return "2–5%";
        if (edge < 0.10) return "5–10%";
        return "10%+";
      }
      case "ev_range": {
        const ev = Number(r.ev ?? 0);
        if (ev < 0) return "EV < 0";
        if (ev < 0.05) return "0–5%";
        if (ev < 0.10) return "5–10%";
        return "10%+";
      }
      case "prediq_range": {
        const score = Number(r.prediq_score ?? 0);
        if (score < 30) return "0–29";
        if (score < 50) return "30–49";
        if (score < 70) return "50–69";
        return "70–100";
      }
      case "period": {
        const d = new Date((r.generated_at as string) ?? "");
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      }
      default:
        return "Todos";
    }
  };

  // Agrupar
  const groups = new Map<
    string,
    {
      won: number;
      lost: number;
      probs: number[];
      outcomes: number[];
      evs: number[];
      clvs: number[];
      odds: number[];
    }
  >();

  for (const r of rows) {
    const key = getKey(r);
    if (!groups.has(key)) {
      groups.set(key, {
        won: 0,
        lost: 0,
        probs: [],
        outcomes: [],
        evs: [],
        clvs: [],
        odds: [],
      });
    }
    const g = groups.get(key)!;
    const isWon = r.result === "won";
    if (isWon) g.won++;
    else g.lost++;

    g.probs.push(Number(r.model_probability ?? 0.5));
    g.outcomes.push(isWon ? 1 : 0);
    if (r.ev != null) g.evs.push(Number(r.ev));
    if (r.clv != null) g.clvs.push(Number(r.clv));
    if (r.best_odds != null) g.odds.push(Number(r.best_odds));
  }

  // Computar metricas por grupo
  const result = [...groups.entries()].map(([key, g]) => {
    const n = g.won + g.lost;
    const hitRate = n > 0 ? g.won / n : null;

    // Brier
    let brier: number | null = null;
    if (n > 0) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += (g.probs[i]! - g.outcomes[i]!) ** 2;
      }
      brier = sum / n;
    }

    // Log Loss
    let ll: number | null = null;
    if (n > 0) {
      const eps = 1e-15;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const p = Math.max(eps, Math.min(1 - eps, g.probs[i]!));
        sum += -(
          g.outcomes[i]! * Math.log(p) +
          (1 - g.outcomes[i]!) * Math.log(1 - p)
        );
      }
      ll = sum / n;
    }

    // ECE
    let eceVal: number | null = null;
    if (n > 0) {
      const bins = Array.from({ length: 10 }, () => ({
        sp: 0,
        so: 0,
        c: 0,
      }));
      for (let i = 0; i < n; i++) {
        const idx = Math.min(Math.floor(g.probs[i]! * 10), 9);
        bins[idx]!.sp += g.probs[i]!;
        bins[idx]!.so += g.outcomes[i]!;
        bins[idx]!.c++;
      }
      let eSum = 0;
      for (const b of bins) {
        if (b.c === 0) continue;
        eSum += (Math.abs(b.sp / b.c - b.so / b.c) * b.c) / n;
      }
      eceVal = eSum;
    }

    // CLV medio
    const clvMean =
      g.clvs.length > 0
        ? g.clvs.reduce((s, v) => s + v, 0) / g.clvs.length
        : null;

    // ROI teorico
    const roiTheoretical =
      g.evs.length > 0
        ? g.evs.reduce((s, v) => s + v, 0) / g.evs.length
        : null;

    // Max drawdown
    let maxDd: number | null = null;
    if (n > 0) {
      let bankroll = 100;
      let peak = 100;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        if (g.outcomes[i]! === 1) {
          bankroll += 1 * ((g.odds[i] ?? 2) - 1);
        } else {
          bankroll -= 1;
        }
        if (bankroll > peak) peak = bankroll;
        const dd = peak > 0 ? (peak - bankroll) / peak : 0;
        if (dd > worst) worst = dd;
      }
      maxDd = worst;
    }

    return {
      key,
      sampleSize: n,
      hitRate: hitRate != null ? +hitRate.toFixed(4) : null,
      brierScore: brier != null ? +brier.toFixed(4) : null,
      logLoss: ll != null ? +ll.toFixed(4) : null,
      ece: eceVal != null ? +eceVal.toFixed(4) : null,
      clvMean: clvMean != null ? +clvMean.toFixed(4) : null,
      roiTheoretical: roiTheoretical != null ? +roiTheoretical.toFixed(4) : null,
      maxDrawdown: maxDd != null ? +maxDd.toFixed(4) : null,
    };
  });

  // Ordenar por sample size decrescente
  result.sort((a, b) => b.sampleSize - a.sampleSize);

  return { rows: result };
}

// ═══════════════════════════════════════════════════════════════════════
// View: calibration
// ═══════════════════════════════════════════════════════════════════════

async function handleCalibration(
  supabase: SupabaseClient,
  hasShadow: boolean,
) {
  if (!hasShadow) {
    return { bins: [], leagueEce: [], eceGlobal: null, mce: null };
  }

  const { data: resolved } = await supabase
    .from("shadow_predictions")
    .select("result, model_probability, league")
    .eq("status", "graded")
    .in("result", ["won", "lost"]);

  const rows: ShadowRow[] = resolved ?? [];
  const n = rows.length;

  if (n === 0) {
    return { bins: [], leagueEce: [], eceGlobal: null, mce: null };
  }

  // 10 bins de calibracao
  const NUM_BINS = 10;
  const bins = Array.from({ length: NUM_BINS }, (_, i) => ({
    binStart: i / NUM_BINS,
    binEnd: (i + 1) / NUM_BINS,
    binMid: (i + 0.5) / NUM_BINS,
    sumPred: 0,
    sumOutcome: 0,
    count: 0,
  }));

  for (const r of rows) {
    const p = Number(r.model_probability ?? 0.5);
    const idx = Math.min(Math.floor(p * NUM_BINS), NUM_BINS - 1);
    bins[idx]!.sumPred += p;
    bins[idx]!.sumOutcome += r.result === "won" ? 1 : 0;
    bins[idx]!.count++;
  }

  let eceGlobal = 0;
  let mce = 0;
  const calibrationBins = bins.map((b) => {
    const predicted = b.count > 0 ? b.sumPred / b.count : b.binMid;
    const observed = b.count > 0 ? b.sumOutcome / b.count : 0;
    const gap = Math.abs(predicted - observed);

    if (b.count > 0) {
      eceGlobal += (gap * b.count) / n;
      if (gap > mce) mce = gap;
    }

    return {
      binStart: +b.binStart.toFixed(2),
      binEnd: +b.binEnd.toFixed(2),
      binMid: +b.binMid.toFixed(2),
      predicted: +predicted.toFixed(4),
      observed: +observed.toFixed(4),
      count: b.count,
    };
  });

  // ECE por liga
  const leagueMap = new Map<
    string,
    { sumPred: number; sumOutcome: number; count: number }[]
  >();

  for (const r of rows) {
    const league = (r.league as string) ?? "Desconhecida";
    if (!leagueMap.has(league)) {
      leagueMap.set(
        league,
        Array.from({ length: NUM_BINS }, () => ({
          sumPred: 0,
          sumOutcome: 0,
          count: 0,
        })),
      );
    }
    const lBins = leagueMap.get(league)!;
    const p = Number(r.model_probability ?? 0.5);
    const idx = Math.min(Math.floor(p * NUM_BINS), NUM_BINS - 1);
    lBins[idx]!.sumPred += p;
    lBins[idx]!.sumOutcome += r.result === "won" ? 1 : 0;
    lBins[idx]!.count++;
  }

  const leagueEce: { league: string; ece: number; sampleSize: number }[] = [];
  for (const [league, lBins] of leagueMap) {
    const totalInLeague = lBins.reduce((s, b) => s + b.count, 0);
    if (totalInLeague < 10) continue; // amostra minima
    let leceVal = 0;
    for (const b of lBins) {
      if (b.count === 0) continue;
      leceVal +=
        (Math.abs(b.sumPred / b.count - b.sumOutcome / b.count) * b.count) /
        totalInLeague;
    }
    leagueEce.push({
      league,
      ece: +leceVal.toFixed(4),
      sampleSize: totalInLeague,
    });
  }

  leagueEce.sort((a, b) => a.ece - b.ece);

  return {
    bins: calibrationBins,
    leagueEce,
    eceGlobal: +eceGlobal.toFixed(4),
    mce: +mce.toFixed(4),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// View: equity-curve
// ═══════════════════════════════════════════════════════════════════════

async function handleEquityCurve(
  supabase: SupabaseClient,
  hasShadow: boolean,
) {
  if (!hasShadow) return { points: [] };

  // Buscar previsoes resolvidas, ordenadas cronologicamente
  const { data: resolved } = await supabase
    .from("shadow_predictions")
    .select("result, best_odds, graded_at, generated_at")
    .in("result", ["won", "lost"])
    .order("graded_at", { ascending: true, nullsFirst: false });

  const rows: ShadowRow[] = resolved ?? [];
  if (rows.length === 0) return { points: [] };

  // Simular evolucao do bankroll — aposta fixa 1 unidade
  let bankroll = 100;
  let peak = 100;
  const points: { date: string; bankroll: number; drawdown: number }[] = [];

  for (const r of rows) {
    const stake = 1;
    if (r.result === "won") {
      bankroll += stake * (Number(r.best_odds ?? 2) - 1);
    } else {
      bankroll -= stake;
    }

    if (bankroll > peak) peak = bankroll;
    const drawdown = peak > 0 ? (peak - bankroll) / peak : 0;

    points.push({
      date: (r.graded_at as string) ?? (r.generated_at as string) ?? "",
      bankroll: +bankroll.toFixed(2),
      drawdown: +drawdown.toFixed(4),
    });
  }

  return { points };
}
