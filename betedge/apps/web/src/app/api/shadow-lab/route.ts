/**
 * GET /api/shadow-lab
 *
 * API route para o dashboard Shadow Lab — validação prospectiva.
 * Suporta múltiplas views via query param `view`:
 *   - overview     — KPIs, critérios de graduação, métricas resumo
 *   - predictions  — lista paginada de previsões shadow
 *   - metrics      — métricas agregadas por dimensão (group_by)
 *   - calibration  — bins de calibração e ECE por liga
 *   - equity-curve — evolução do bankroll simulado
 *
 * Abordagem: Python Engine é a ÚNICA fonte de métricas quantitativas
 * (Brier, Log Loss, ECE, Drawdown, etc.). Views quantitativas usam
 * exclusivamente o engine. Predictions (leitura de dados) tem fallback
 * para Supabase quando engine indisponível.
 *
 * NOTA: Cálculos quantitativos (Brier, Log Loss, ECE, Drawdown, calibração,
 * equity curve) foram REMOVIDOS do TypeScript. Python é fonte canônica.
 * Ver: PYTHON_TS_CONVERGENCE_REPORT.md
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Tipo genérico para linhas retornadas pelo Supabase (schema dinâmico)
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
    // Engine indisponível — fallback para dados vazios
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
    return !error;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Respostas vazias para quando engine indisponível ou sem dados
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
    _engineAvailable: false,
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

  // ─── Engine indisponível ────────────────────────────────────────────
  // Views quantitativas (overview, metrics, calibration, equity-curve)
  // requerem o Python Engine como fonte canônica. Retornam dados vazios
  // quando engine indisponível. Predictions (leitura de dados sem
  // cálculos) tem fallback para Supabase.

  try {
    switch (view) {
      case "overview":
        // Métricas quantitativas requerem engine — retorna dados vazios
        return NextResponse.json(emptyOverview());

      case "predictions":
        // Predictions é leitura + DTO mapping — fallback Supabase OK
        return NextResponse.json(await handlePredictions(searchParams));

      case "metrics":
        // Métricas quantitativas requerem engine
        return NextResponse.json({ rows: [], _engineAvailable: false });

      case "calibration":
        // Calibração requer engine
        return NextResponse.json({
          bins: [],
          leagueEce: [],
          eceGlobal: null,
          mce: null,
          _engineAvailable: false,
        });

      case "equity-curve":
        // Equity curve requer engine
        return NextResponse.json({ points: [], _engineAvailable: false });

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
// View: predictions (leitura de dados — sem cálculos quantitativos)
// ═══════════════════════════════════════════════════════════════════════

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

async function handlePredictions(params: URLSearchParams) {
  const supabase = await createClient();
  const hasShadow = await tableExists(supabase, "shadow_predictions");

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

  // DTO mapping — conversão de tipos e formatação, sem cálculos
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

  // Filtro de busca pós-query (time no nome) — filtragem, não cálculo
  if (search) {
    predictions = predictions.filter(
      (p) =>
        p.homeTeam.toLowerCase().includes(search) ||
        p.awayTeam.toLowerCase().includes(search),
    );
  }

  // Ligas disponíveis para o dropdown
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
