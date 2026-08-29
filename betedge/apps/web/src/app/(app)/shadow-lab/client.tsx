"use client";

/**
 * ShadowLabClient — dashboard interativo de validacao prospectiva.
 *
 * Opera em shadow mode: previsoes simuladas sem dinheiro real.
 * Avalia qualidade do pipeline antes de qualquer operacao real.
 *
 * 4 abas: Visao Geral | Previsoes | Performance | Calibracao
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  BarChart3,
  Percent,
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  Crosshair,
  Layers,
  FlaskConical,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ComposedChart,
  Scatter,
  ReferenceLine,
  Area,
  AreaChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════
// Tipos locais
// ═══════════════════════════════════════════════════════════════════════

type TabId = "overview" | "predictions" | "performance" | "calibration";

interface GraduationCriterion {
  current: number;
  target: number;
  met: boolean;
}

interface GraduationCriteria {
  events200: GraduationCriterion;
  bets500: GraduationCriterion;
  ece3Leagues: { leagues: string[]; met: boolean };
  clvPositive: { value: number | null; met: boolean };
  noLeakage: { met: boolean };
  pythonTsConvergence: { met: boolean };
}

interface OverviewData {
  totalPredictions: number;
  openPredictions: number;
  gradedPredictions: number;
  hitRate: number | null;
  roiTheoretical: number | null;
  brierScore: number | null;
  logLoss: number | null;
  ece: number | null;
  clvMean: number | null;
  maxDrawdown: number | null;
  sampleSize: number;
  graduationCriteria: GraduationCriteria;
}

interface EquityPoint {
  date: string;
  bankroll: number;
  drawdown: number;
}

interface ShadowPrediction {
  id: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  market: string;
  outcome: string;
  bestOdds: number | null;
  fairProb: number | null;
  modelProb: number | null;
  edge: number | null;
  ev: number | null;
  prediqScore: number | null;
  kelly: number | null;
  status: string;
  result: string | null;
  createdAt: string;
  settledAt: string | null;
}

interface PredictionsResponse {
  predictions: ShadowPrediction[];
  total: number;
  leagues: string[];
}

interface MetricRow {
  key: string;
  sampleSize: number;
  hitRate: number | null;
  brierScore: number | null;
  logLoss: number | null;
  ece: number | null;
  clvMean: number | null;
  roiTheoretical: number | null;
  maxDrawdown: number | null;
}

interface CalibrationBin {
  binStart: number;
  binEnd: number;
  binMid: number;
  predicted: number;
  observed: number;
  count: number;
}

interface LeagueEce {
  league: string;
  ece: number;
  sampleSize: number;
}

interface CalibrationData {
  bins: CalibrationBin[];
  leagueEce: LeagueEce[];
  eceGlobal: number | null;
  mce: number | null;
}

// ═══════════════════════════════════════════════════════════════════════
// Utilitarios de formatacao
// ═══════════════════════════════════════════════════════════════════════

const fmtPercent = (v: number | null) =>
  v != null ? `${(v * 100).toFixed(2)}%` : "—";

const fmtOdds = (v: number | null) =>
  v != null ? v.toFixed(2) : "—";

const fmtScore = (v: number | null) =>
  v != null ? v.toFixed(4) : "—";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

// ═══════════════════════════════════════════════════════════════════════
// Helpers de cor
// ═══════════════════════════════════════════════════════════════════════

const edgeColor = (edge: number) =>
  edge > 0.05
    ? "text-emerald-400"
    : edge > 0.02
      ? "text-amber-400"
      : edge < 0
        ? "text-red-400"
        : "text-foreground-muted";

const prediqBadge = (score: number): "default" | "warning" | "secondary" =>
  score >= 70 ? "default" : score >= 50 ? "warning" : "secondary";

/** Cor semantica para metricas: verde = bom, vermelho = ruim */
function metricColor(
  value: number | null,
  direction: "low" | "high",
  threshold: number,
): string {
  if (value == null) return "text-foreground-subtle";
  if (direction === "low") {
    return value <= threshold
      ? "text-emerald-400"
      : value <= threshold * 2
        ? "text-amber-400"
        : "text-red-400";
  }
  return value >= threshold
    ? "text-emerald-400"
    : value >= threshold * 0.5
      ? "text-amber-400"
      : "text-red-400";
}

// ═══════════════════════════════════════════════════════════════════════
// Abas
// ═══════════════════════════════════════════════════════════════════════

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Visao Geral" },
  { id: "predictions", label: "Previsoes" },
  { id: "performance", label: "Performance" },
  { id: "calibration", label: "Calibracao" },
];

type GroupByDimension =
  | "league"
  | "market"
  | "odds_range"
  | "edge_range"
  | "ev_range"
  | "prediq_range"
  | "model"
  | "period";

const GROUP_DIMENSIONS: { key: GroupByDimension; label: string }[] = [
  { key: "league", label: "Liga" },
  { key: "market", label: "Mercado" },
  { key: "odds_range", label: "Faixa de Odds" },
  { key: "edge_range", label: "Faixa de Edge" },
  { key: "ev_range", label: "Faixa de EV" },
  { key: "prediq_range", label: "Faixa de PREDIQ" },
  { key: "model", label: "Modelo" },
  { key: "period", label: "Periodo" },
];

// ═══════════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════════

export function ShadowLabClient() {
  const [tab, setTab] = useState<TabId>("overview");
  const [refreshing, setRefreshing] = useState(false);

  // ─── Estado da aba Visao Geral ──────────────────────────────────────
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [equityLoading, setEquityLoading] = useState(true);

  // ─── Estado da aba Previsoes ────────────────────────────────────────
  const [predictions, setPredictions] = useState<PredictionsResponse | null>(null);
  const [predsLoading, setPredsLoading] = useState(false);
  const [predsError, setPredsError] = useState<string | null>(null);
  const [predsStatus, setPredsStatus] = useState<string>("all");
  const [predsLeague, setPredsLeague] = useState<string>("");
  const [predsSearch, setPredsSearch] = useState("");
  const [predsPage, setPredsPage] = useState(0);
  const PREDS_LIMIT = 50;

  // ─── Estado da aba Performance ──────────────────────────────────────
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupByDimension>("league");

  // ─── Estado da aba Calibracao ───────────────────────────────────────
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [calibrationLoading, setCalibrationLoading] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  // ─── Dropdowns ──────────────────────────────────────────────────────
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [leagueDropdownOpen, setLeagueDropdownOpen] = useState(false);

  // ═══════════════════════════════════════════════════════════════════
  // Fetchers
  // ═══════════════════════════════════════════════════════════════════

  const loadOverview = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setOverviewLoading(true);
    setOverviewError(null);

    try {
      const res = await fetch("/api/shadow-lab?view=overview");
      if (!res.ok) throw new Error("Falha ao buscar visao geral");
      const json: OverviewData = await res.json();
      setOverview(json);
    } catch (err) {
      setOverviewError((err as Error).message);
    } finally {
      setOverviewLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadEquity = useCallback(async () => {
    setEquityLoading(true);
    try {
      const res = await fetch("/api/shadow-lab?view=equity-curve");
      if (!res.ok) throw new Error("Falha ao buscar curva de equity");
      const json = await res.json();
      setEquity(json.points ?? []);
    } catch {
      // silencioso — grafico simplesmente nao aparece
    } finally {
      setEquityLoading(false);
    }
  }, []);

  const loadPredictions = useCallback(async () => {
    setPredsLoading(true);
    setPredsError(null);

    try {
      const params = new URLSearchParams();
      params.set("view", "predictions");
      params.set("status", predsStatus);
      params.set("limit", String(PREDS_LIMIT));
      params.set("offset", String(predsPage * PREDS_LIMIT));
      if (predsLeague) params.set("league", predsLeague);
      if (predsSearch.trim()) params.set("search", predsSearch.trim());

      const res = await fetch(`/api/shadow-lab?${params}`);
      if (!res.ok) throw new Error("Falha ao buscar previsoes");
      const json: PredictionsResponse = await res.json();
      setPredictions(json);
    } catch (err) {
      setPredsError((err as Error).message);
    } finally {
      setPredsLoading(false);
    }
  }, [predsStatus, predsLeague, predsSearch, predsPage]);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(null);

    try {
      const params = new URLSearchParams();
      params.set("view", "metrics");
      params.set("group_by", groupBy);

      const res = await fetch(`/api/shadow-lab?${params}`);
      if (!res.ok) throw new Error("Falha ao buscar metricas");
      const json = await res.json();
      setMetrics(json.rows ?? []);
    } catch (err) {
      setMetricsError((err as Error).message);
    } finally {
      setMetricsLoading(false);
    }
  }, [groupBy]);

  const loadCalibration = useCallback(async () => {
    setCalibrationLoading(true);
    setCalibrationError(null);

    try {
      const res = await fetch("/api/shadow-lab?view=calibration");
      if (!res.ok) throw new Error("Falha ao buscar calibracao");
      const json: CalibrationData = await res.json();
      setCalibration(json);
    } catch (err) {
      setCalibrationError((err as Error).message);
    } finally {
      setCalibrationLoading(false);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // Effects — carrega dados conforme aba ativa
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (tab === "overview") {
      loadOverview();
      loadEquity();
    }
  }, [tab, loadOverview, loadEquity]);

  useEffect(() => {
    if (tab === "predictions") loadPredictions();
  }, [tab, loadPredictions]);

  useEffect(() => {
    if (tab === "performance") loadMetrics();
  }, [tab, loadMetrics]);

  useEffect(() => {
    if (tab === "calibration") loadCalibration();
  }, [tab, loadCalibration]);

  // Reset paginacao ao trocar filtros de previsoes
  useEffect(() => {
    setPredsPage(0);
  }, [predsStatus, predsLeague, predsSearch]);

  // Refresh global — recarrega a aba ativa
  const handleRefresh = useCallback(() => {
    if (tab === "overview") {
      loadOverview(true);
      loadEquity();
    } else if (tab === "predictions") {
      loadPredictions();
    } else if (tab === "performance") {
      loadMetrics();
    } else if (tab === "calibration") {
      loadCalibration();
    }
  }, [tab, loadOverview, loadEquity, loadPredictions, loadMetrics, loadCalibration]);

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ─── Barra de abas + botao atualizar ──────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-card-border/50 bg-background-surface/40 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "bg-primary/15 text-primary-400"
                  : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Atualizar dados"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-card-border/50 text-foreground-subtle transition-colors hover:bg-card/60 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* ─── Status badge ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <Badge variant="outline" className="px-3 py-1.5 text-sm font-semibold border-amber-500 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
          <FlaskConical className="w-4 h-4 mr-1.5" />
          COLETANDO EVIDÊNCIAS
        </Badge>
        <span className="text-sm text-muted-foreground">
          Shadow Mode v1 — validação prospectiva sem dinheiro real
        </span>
      </div>

      {/* ─── Graduation progress ──────────────────────────────────── */}
      {overview && (
        <Card className="mb-6 border-amber-200 dark:border-amber-800/50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold">Progresso para Graduação</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {Object.values(overview.graduationCriteria).filter(c => 'met' in c && c.met).length} / {Object.values(overview.graduationCriteria).length} critérios
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {[
                { label: "Eventos", criterion: overview.graduationCriteria.events200, format: (c: GraduationCriterion) => `${c.current}/${c.target}` },
                { label: "Seleções", criterion: overview.graduationCriteria.bets500, format: (c: GraduationCriterion) => `${c.current}/${c.target}` },
                { label: "ECE < 0.05", criterion: overview.graduationCriteria.ece3Leagues, format: (c: { leagues: string[]; met: boolean }) => `${c.leagues.length} ligas` },
                { label: "CLV > 0", criterion: overview.graduationCriteria.clvPositive, format: (c: { value: number | null; met: boolean }) => c.value != null ? `${(c.value * 100).toFixed(2)}%` : "N/A" },
                { label: "Leakage", criterion: overview.graduationCriteria.noLeakage, format: () => "Verificado" },
                { label: "Py/TS", criterion: overview.graduationCriteria.pythonTsConvergence, format: () => "Manual" },
              ].map((item, i) => (
                <div key={i} className={cn(
                  "flex flex-col items-center p-2 rounded-md border text-center",
                  item.criterion.met
                    ? "border-green-200 bg-green-50 dark:border-green-800/50 dark:bg-green-950/20"
                    : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50"
                )}>
                  {item.criterion.met ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mb-1" />
                  ) : (
                    <Clock className="w-4 h-4 text-zinc-400 mb-1" />
                  )}
                  <span className="text-xs font-medium">{item.label}</span>
                  <span className="text-[10px] text-muted-foreground">{item.format(item.criterion as any)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Conteudo da aba ativa ────────────────────────────────── */}
      {tab === "overview" && (
        <OverviewTab
          data={overview}
          loading={overviewLoading}
          error={overviewError}
          equity={equity}
          equityLoading={equityLoading}
        />
      )}
      {tab === "predictions" && (
        <PredictionsTab
          data={predictions}
          loading={predsLoading}
          error={predsError}
          status={predsStatus}
          league={predsLeague}
          search={predsSearch}
          page={predsPage}
          limit={PREDS_LIMIT}
          onStatusChange={setPredsStatus}
          onLeagueChange={setPredsLeague}
          onSearchChange={setPredsSearch}
          onPageChange={setPredsPage}
          statusDropdownOpen={statusDropdownOpen}
          setStatusDropdownOpen={setStatusDropdownOpen}
          leagueDropdownOpen={leagueDropdownOpen}
          setLeagueDropdownOpen={setLeagueDropdownOpen}
        />
      )}
      {tab === "performance" && (
        <PerformanceTab
          rows={metrics}
          loading={metricsLoading}
          error={metricsError}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
        />
      )}
      {tab === "calibration" && (
        <CalibrationTab
          data={calibration}
          loading={calibrationLoading}
          error={calibrationError}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ABA 1 — Visao Geral
// ═══════════════════════════════════════════════════════════════════════

function OverviewTab({
  data,
  loading,
  error,
  equity,
  equityLoading,
}: {
  data: OverviewData | null;
  loading: boolean;
  error: string | null;
  equity: EquityPoint[];
  equityLoading: boolean;
}) {
  if (loading) return <OverviewSkeleton />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total Previsoes"
          value={data.totalPredictions.toLocaleString("pt-BR")}
          subtitle={`${data.openPredictions} abertas · ${data.gradedPredictions} avaliadas`}
          icon={Database}
        />
        <KpiCard
          label="Hit Rate"
          value={fmtPercent(data.hitRate)}
          icon={Target}
          valueColor={metricColor(data.hitRate, "high", 0.5)}
        />
        <KpiCard
          label="ROI Teorico"
          value={fmtPercent(data.roiTheoretical)}
          icon={TrendingUp}
          valueColor={metricColor(data.roiTheoretical, "high", 0)}
        />
        <KpiCard
          label="CLV Medio"
          value={fmtPercent(data.clvMean)}
          icon={BarChart3}
          valueColor={metricColor(data.clvMean, "high", 0)}
        />
      </div>

      {/* Criterios de Graduacao */}
      <GraduationPanel criteria={data.graduationCriteria} />

      {/* Curva de Equity */}
      {!equityLoading && equity.length > 0 && (
        <EquityCurveChart points={equity} />
      )}
      {equityLoading && <Skeleton className="h-72 w-full rounded-2xl" />}

      {/* Metricas Resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricMiniCard
          label="Brier Score"
          value={fmtScore(data.brierScore)}
          color={metricColor(data.brierScore, "low", 0.25)}
        />
        <MetricMiniCard
          label="Log Loss"
          value={fmtScore(data.logLoss)}
          color={metricColor(data.logLoss, "low", 0.69)}
        />
        <MetricMiniCard
          label="ECE"
          value={fmtScore(data.ece)}
          color={metricColor(data.ece, "low", 0.05)}
        />
        <MetricMiniCard
          label="Max Drawdown"
          value={fmtPercent(data.maxDrawdown)}
          color={metricColor(data.maxDrawdown, "low", 0.2)}
        />
        <MetricMiniCard
          label="Sample Size"
          value={data.sampleSize.toLocaleString("pt-BR")}
          color={data.sampleSize >= 200 ? "text-emerald-400" : "text-amber-400"}
        />
      </div>
    </div>
  );
}

/** Card KPI individual */
function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  valueColor,
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  valueColor?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary-400" />
        </div>
        <div className="min-w-0">
          <p
            className={cn(
              "text-xl font-bold tabular-nums",
              valueColor ?? "text-foreground",
            )}
          >
            {value}
          </p>
          <p className="truncate text-xs text-foreground-subtle">{label}</p>
          {subtitle && (
            <p className="text-[10px] text-foreground-subtle">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Mini-card de metrica resumo */
function MetricMiniCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-card-border/30 bg-card/40 p-4">
      <p className={cn("text-lg font-bold tabular-nums", color ?? "text-foreground")}>
        {value}
      </p>
      <p className="text-[10px] text-foreground-subtle">{label}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Painel de Criterios de Graduacao
// ═══════════════════════════════════════════════════════════════════════

function GraduationPanel({ criteria }: { criteria: GraduationCriteria }) {
  const items = [
    {
      label: "≥200 eventos",
      current: criteria.events200.current,
      target: criteria.events200.target,
      met: criteria.events200.met,
      progress: Math.min(1, criteria.events200.current / criteria.events200.target),
    },
    {
      label: "≥500 apostas simuladas",
      current: criteria.bets500.current,
      target: criteria.bets500.target,
      met: criteria.bets500.met,
      progress: Math.min(1, criteria.bets500.current / criteria.bets500.target),
    },
    {
      label: "ECE < 0.05 em 3 ligas",
      current: criteria.ece3Leagues.leagues.length,
      target: 3,
      met: criteria.ece3Leagues.met,
      progress: Math.min(1, criteria.ece3Leagues.leagues.length / 3),
      subtitle: criteria.ece3Leagues.leagues.length > 0
        ? criteria.ece3Leagues.leagues.join(", ")
        : undefined,
    },
    {
      label: "CLV medio positivo",
      current: null,
      target: null,
      met: criteria.clvPositive.met,
      progress: criteria.clvPositive.met ? 1 : 0,
      subtitle: criteria.clvPositive.value != null
        ? `CLV: ${fmtPercent(criteria.clvPositive.value)}`
        : undefined,
    },
    {
      label: "Sem data leakage",
      current: null,
      target: null,
      met: criteria.noLeakage.met,
      progress: criteria.noLeakage.met ? 1 : 0,
    },
    {
      label: "Convergencia Python/TS",
      current: null,
      target: null,
      met: criteria.pythonTsConvergence.met,
      progress: criteria.pythonTsConvergence.met ? 1 : 0,
    },
  ];

  const metCount = items.filter((i) => i.met).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Crosshair className="h-4 w-4 text-primary-400" />
          Criterios de Graduacao
          <Badge
            variant={metCount === items.length ? "default" : "warning"}
            className="ml-2"
          >
            {metCount}/{items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-3 rounded-xl border border-card-border/30 p-3"
            >
              {item.met ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    item.met ? "text-emerald-400" : "text-foreground-muted",
                  )}
                >
                  {item.label}
                </p>
                {item.current != null && item.target != null && (
                  <div className="mt-1.5">
                    <div className="flex justify-between text-[10px] text-foreground-subtle">
                      <span>{item.current.toLocaleString("pt-BR")}</span>
                      <span>{item.target.toLocaleString("pt-BR")}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-background-surface">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          item.met ? "bg-emerald-500" : "bg-amber-500",
                        )}
                        style={{ width: `${item.progress * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {item.subtitle && (
                  <p className="mt-1 text-[10px] text-foreground-subtle">
                    {item.subtitle}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Curva de Equity (Recharts)
// ═══════════════════════════════════════════════════════════════════════

function EquityCurveChart({ points }: { points: EquityPoint[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary-400" />
          Curva de Equity — Bankroll Simulado
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(51,65,85,0.4)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) =>
                  new Date(v).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  })
                }
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}`}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid rgba(51,65,85,0.5)",
                  borderRadius: "0.75rem",
                  fontSize: 12,
                  color: "#e2e8f0",
                }}
                formatter={(value: number) => [
                  `${value.toFixed(2)} u`,
                  "Bankroll",
                ]}
                labelFormatter={(label: string) =>
                  new Date(label).toLocaleDateString("pt-BR")
                }
              />
              <ReferenceLine
                y={100}
                stroke="rgba(148,163,184,0.3)"
                strokeDasharray="4 4"
                label={{
                  value: "Base",
                  fill: "#64748b",
                  fontSize: 10,
                  position: "right",
                }}
              />
              <Area
                type="monotone"
                dataKey="bankroll"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#equityFill)"
                dot={false}
                activeDot={{ r: 4, fill: "#10b981" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ABA 2 — Previsoes
// ═══════════════════════════════════════════════════════════════════════

const STATUS_LABELS: Record<string, string> = {
  all: "Todas",
  open: "Abertas",
  won: "Acertadas",
  lost: "Erradas",
  void: "Void",
};

function PredictionsTab({
  data,
  loading,
  error,
  status,
  league,
  search,
  page,
  limit,
  onStatusChange,
  onLeagueChange,
  onSearchChange,
  onPageChange,
  statusDropdownOpen,
  setStatusDropdownOpen,
  leagueDropdownOpen,
  setLeagueDropdownOpen,
}: {
  data: PredictionsResponse | null;
  loading: boolean;
  error: string | null;
  status: string;
  league: string;
  search: string;
  page: number;
  limit: number;
  onStatusChange: (v: string) => void;
  onLeagueChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  onPageChange: (v: number | ((p: number) => number)) => void;
  statusDropdownOpen: boolean;
  setStatusDropdownOpen: (v: boolean) => void;
  leagueDropdownOpen: boolean;
  setLeagueDropdownOpen: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            {/* Filtro de status */}
            <div className="relative">
              <button
                onClick={() => {
                  setStatusDropdownOpen(!statusDropdownOpen);
                  setLeagueDropdownOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg border border-card-border/50 bg-background-surface/60 px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/30"
              >
                <span>{STATUS_LABELS[status] ?? status}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-foreground-subtle transition-transform",
                    statusDropdownOpen && "rotate-180",
                  )}
                />
              </button>
              {statusDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setStatusDropdownOpen(false)}
                  />
                  <div className="absolute left-0 top-10 z-50 w-44 rounded-xl border border-card-border/50 bg-background-surface p-1 shadow-glass">
                    {Object.keys(STATUS_LABELS).map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          onStatusChange(s);
                          setStatusDropdownOpen(false);
                        }}
                        className={cn(
                          "flex w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          status === s
                            ? "bg-primary/10 text-primary-400"
                            : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
                        )}
                      >
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Filtro de liga */}
            <div className="relative">
              <button
                onClick={() => {
                  setLeagueDropdownOpen(!leagueDropdownOpen);
                  setStatusDropdownOpen(false);
                }}
                className="flex items-center gap-2 rounded-lg border border-card-border/50 bg-background-surface/60 px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/30"
              >
                <span className="max-w-[180px] truncate">
                  {league || "Todas as ligas"}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-foreground-subtle transition-transform",
                    leagueDropdownOpen && "rotate-180",
                  )}
                />
              </button>
              {leagueDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setLeagueDropdownOpen(false)}
                  />
                  <div className="absolute left-0 top-10 z-50 max-h-64 w-64 overflow-y-auto rounded-xl border border-card-border/50 bg-background-surface p-1 shadow-glass">
                    <button
                      onClick={() => {
                        onLeagueChange("");
                        setLeagueDropdownOpen(false);
                      }}
                      className={cn(
                        "flex w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        !league
                          ? "bg-primary/10 text-primary-400"
                          : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
                      )}
                    >
                      Todas as ligas
                    </button>
                    {(data?.leagues ?? []).map((l) => (
                      <button
                        key={l}
                        onClick={() => {
                          onLeagueChange(l);
                          setLeagueDropdownOpen(false);
                        }}
                        className={cn(
                          "flex w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          league === l
                            ? "bg-primary/10 text-primary-400"
                            : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
                        )}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Busca */}
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
              <input
                type="text"
                placeholder="Buscar time ou evento..."
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-10 w-full rounded-lg border border-card-border/50 bg-background-surface/60 pl-10 pr-4 text-sm text-foreground placeholder:text-foreground-subtle focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Erro */}
      {error && <ErrorBanner message={error} />}

      {/* Carregando */}
      {loading && <PredictionsSkeleton />}

      {/* Tabela */}
      {data && !loading && (
        <>
          {data.predictions.length === 0 ? (
            <EmptyState message="Nenhuma previsao encontrada com os filtros selecionados." />
          ) : (
            <>
              <PredictionsTable predictions={data.predictions} />

              {/* Paginacao */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-foreground-subtle">
                  Exibindo {page * limit + 1}–
                  {Math.min((page + 1) * limit, data.total)} de {data.total}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onPageChange((p: number) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-card/60 hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-2 text-xs font-medium text-foreground-muted">
                    {page + 1}
                  </span>
                  <button
                    onClick={() => onPageChange((p: number) => p + 1)}
                    disabled={data.predictions.length < limit}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-card/60 hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Tabela densa de previsoes shadow */
function PredictionsTable({ predictions }: { predictions: ShadowPrediction[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="text-base">Previsoes Shadow</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/50 bg-background-surface/40">
                <th className="sticky left-0 z-10 bg-background-surface/90 backdrop-blur-sm min-w-[160px] px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Evento
                </th>
                <th className="min-w-[80px] px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Liga
                </th>
                <th className="min-w-[100px] px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Mercado / Outcome
                </th>
                <th className="min-w-[60px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Best Odds
                </th>
                <th className="min-w-[65px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Fair Prob
                </th>
                <th className="min-w-[70px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Model Prob
                </th>
                <th className="min-w-[60px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Edge
                </th>
                <th className="min-w-[55px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  EV
                </th>
                <th className="min-w-[60px] px-3 py-2 text-center text-xs font-semibold text-foreground-subtle">
                  PREDIQ
                </th>
                <th className="min-w-[55px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Kelly
                </th>
                <th className="min-w-[70px] px-3 py-2 text-center text-xs font-semibold text-foreground-subtle">
                  Status
                </th>
                <th className="min-w-[60px] px-3 py-2 text-center text-xs font-semibold text-foreground-subtle">
                  Resultado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/20">
              {predictions.map((p) => (
                <PredictionRow key={p.id} prediction={p} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function PredictionRow({ prediction: p }: { prediction: ShadowPrediction }) {
  const statusVariant: Record<string, "outline" | "default" | "danger" | "secondary"> = {
    open: "outline",
    won: "default",
    lost: "danger",
    void: "secondary",
  };

  const statusLabel: Record<string, string> = {
    open: "Aberta",
    won: "Acertou",
    lost: "Errou",
    void: "Void",
  };

  return (
    <tr className="transition-colors hover:bg-card/30">
      <td className="sticky left-0 z-10 bg-background/90 backdrop-blur-sm px-3 py-2">
        <p className="text-sm font-medium text-foreground whitespace-nowrap">
          {p.homeTeam}
        </p>
        <p className="text-xs text-foreground-muted whitespace-nowrap">
          {p.awayTeam}
        </p>
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline" className="text-[10px] whitespace-nowrap">
          {p.league}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <span className="text-xs font-medium text-foreground whitespace-nowrap">
          {p.market}
        </span>
        <br />
        <span className="text-[10px] text-foreground-subtle">{p.outcome}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="font-mono text-xs font-medium text-foreground tabular-nums">
          {fmtOdds(p.bestOdds)}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="font-mono text-xs text-foreground-muted tabular-nums">
          {fmtPercent(p.fairProb)}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="font-mono text-xs font-medium text-foreground tabular-nums">
          {fmtPercent(p.modelProb)}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        {p.edge != null ? (
          <span
            className={cn(
              "font-mono text-xs font-semibold tabular-nums",
              edgeColor(p.edge),
            )}
          >
            {p.edge >= 0 ? "+" : ""}
            {fmtPercent(p.edge)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {p.ev != null ? (
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              p.ev > 0 ? "text-emerald-400" : "text-red-400",
            )}
          >
            {p.ev >= 0 ? "+" : ""}
            {fmtPercent(p.ev)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {p.prediqScore != null ? (
          <Badge variant={prediqBadge(p.prediqScore)} className="text-[10px]">
            {p.prediqScore.toFixed(0)}
          </Badge>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {p.kelly != null ? (
          <span className="font-mono text-xs text-foreground-muted tabular-nums">
            {(p.kelly * 100).toFixed(1)}%
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-3 py-2 text-center">
        <Badge
          variant={statusVariant[p.status] ?? "outline"}
          className="text-[10px] whitespace-nowrap"
        >
          {statusLabel[p.status] ?? p.status}
        </Badge>
      </td>
      <td className="px-3 py-2 text-center">
        {p.result != null ? (
          <span className="text-xs font-medium text-foreground">{p.result}</span>
        ) : (
          <Dash />
        )}
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ABA 3 — Performance
// ═══════════════════════════════════════════════════════════════════════

function PerformanceTab({
  rows,
  loading,
  error,
  groupBy,
  onGroupByChange,
}: {
  rows: MetricRow[];
  loading: boolean;
  error: string | null;
  groupBy: GroupByDimension;
  onGroupByChange: (v: GroupByDimension) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Seletor de dimensao */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-2">
            {GROUP_DIMENSIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => onGroupByChange(d.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  groupBy === d.key
                    ? "bg-primary/15 text-primary-400 border border-primary/30"
                    : "border border-card-border/50 text-foreground-muted hover:bg-card/60 hover:text-foreground",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && <ErrorBanner message={error} />}
      {loading && <Skeleton className="h-96 w-full rounded-2xl" />}

      {!loading && !error && (
        <MetricsTable rows={rows} groupLabel={GROUP_DIMENSIONS.find((d) => d.key === groupBy)?.label ?? groupBy} />
      )}
    </div>
  );
}

function MetricsTable({
  rows,
  groupLabel,
}: {
  rows: MetricRow[];
  groupLabel: string;
}) {
  if (rows.length === 0) {
    return <EmptyState message="Nenhuma metrica disponivel para esta dimensao." />;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4 text-primary-400" />
          Metricas por {groupLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/50 bg-background-surface/40">
                <th className="sticky left-0 z-10 bg-background-surface/90 backdrop-blur-sm min-w-[120px] px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  {groupLabel}
                </th>
                <th className="min-w-[50px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  N
                </th>
                <th className="min-w-[65px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Hit Rate
                </th>
                <th className="min-w-[60px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Brier
                </th>
                <th className="min-w-[65px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Log Loss
                </th>
                <th className="min-w-[50px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  ECE
                </th>
                <th className="min-w-[60px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  CLV Medio
                </th>
                <th className="min-w-[65px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  ROI Teor.
                </th>
                <th className="min-w-[65px] px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Max DD
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/20">
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="transition-colors hover:bg-card/30"
                >
                  <td className="sticky left-0 z-10 bg-background/90 backdrop-blur-sm px-3 py-2">
                    <span className="text-xs font-medium text-foreground whitespace-nowrap">
                      {row.key}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        row.sampleSize >= 50 ? "text-foreground" : "text-amber-400",
                      )}
                    >
                      {row.sampleSize.toLocaleString("pt-BR")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        metricColor(row.hitRate, "high", 0.5),
                      )}
                    >
                      {fmtPercent(row.hitRate)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        metricColor(row.brierScore, "low", 0.25),
                      )}
                    >
                      {fmtScore(row.brierScore)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        metricColor(row.logLoss, "low", 0.69),
                      )}
                    >
                      {fmtScore(row.logLoss)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        metricColor(row.ece, "low", 0.05),
                      )}
                    >
                      {fmtScore(row.ece)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        metricColor(row.clvMean, "high", 0),
                      )}
                    >
                      {fmtPercent(row.clvMean)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        metricColor(row.roiTheoretical, "high", 0),
                      )}
                    >
                      {fmtPercent(row.roiTheoretical)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        metricColor(
                          row.maxDrawdown != null ? -row.maxDrawdown : null,
                          "high",
                          -0.2,
                        ),
                      )}
                    >
                      {fmtPercent(row.maxDrawdown)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ABA 4 — Calibracao
// ═══════════════════════════════════════════════════════════════════════

function CalibrationTab({
  data,
  loading,
  error,
}: {
  data: CalibrationData | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <CalibrationSkeleton />;
  if (error) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Metricas de calibracao em destaque */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricMiniCard
          label="ECE Global"
          value={fmtScore(data.eceGlobal)}
          color={metricColor(data.eceGlobal, "low", 0.05)}
        />
        <MetricMiniCard
          label="MCE (Maximo)"
          value={fmtScore(data.mce)}
          color={metricColor(data.mce, "low", 0.1)}
        />
        <MetricMiniCard
          label="Bins Calibrados"
          value={`${data.bins.filter((b) => Math.abs(b.predicted - b.observed) <= 0.05).length}/${data.bins.length}`}
          color="text-foreground"
        />
        <MetricMiniCard
          label="Total de Amostras"
          value={data.bins.reduce((s, b) => s + b.count, 0).toLocaleString("pt-BR")}
          color="text-foreground"
        />
      </div>

      {/* Reliability Curve */}
      {data.bins.length > 0 && <ReliabilityCurve bins={data.bins} />}

      {/* ECE por Liga */}
      {data.leagueEce.length > 0 && <LeagueEceTable rows={data.leagueEce} />}
    </div>
  );
}

/** Curva de confiabilidade (reliability diagram) */
function ReliabilityCurve({ bins }: { bins: CalibrationBin[] }) {
  // Dados para a diagonal perfeita
  const diagonal = [
    { predicted: 0, observed: 0 },
    { predicted: 1, observed: 1 },
  ];

  // Preparar dados com tamanho proporcional ao count
  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const chartBins = bins.map((b) => ({
    ...b,
    size: 40 + (b.count / maxCount) * 160, // Tamanho entre 40 e 200
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary-400" />
          Curva de Confiabilidade
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartBins}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(51,65,85,0.4)"
              />
              <XAxis
                type="number"
                dataKey="predicted"
                domain={[0, 1]}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                label={{
                  value: "Probabilidade Prevista",
                  position: "insideBottom",
                  offset: -5,
                  fill: "#64748b",
                  fontSize: 11,
                }}
              />
              <YAxis
                type="number"
                domain={[0, 1]}
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                width={50}
                label={{
                  value: "Frequencia Observada",
                  angle: -90,
                  position: "insideLeft",
                  fill: "#64748b",
                  fontSize: 11,
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid rgba(51,65,85,0.5)",
                  borderRadius: "0.75rem",
                  fontSize: 12,
                  color: "#e2e8f0",
                }}
                formatter={(value: number, name: string) => {
                  if (name === "observed")
                    return [`${(value * 100).toFixed(1)}%`, "Observado"];
                  return [`${(value * 100).toFixed(1)}%`, name];
                }}
                labelFormatter={(label: number) =>
                  `Previsto: ${(label * 100).toFixed(0)}%`
                }
              />
              {/* Diagonal de calibracao perfeita */}
              <ReferenceLine
                segment={[
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ]}
                stroke="rgba(148,163,184,0.4)"
                strokeDasharray="6 4"
                label={{
                  value: "Perfeito",
                  fill: "#64748b",
                  fontSize: 10,
                  position: "insideTopLeft",
                }}
              />
              {/* Pontos do scatter — tamanho proporcional ao N */}
              <Scatter
                dataKey="observed"
                fill="#10b981"
                fillOpacity={0.7}
                stroke="#10b981"
                strokeWidth={1}
              />
              {/* Linha conectando os bins */}
              <Line
                type="monotone"
                dataKey="observed"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center text-[10px] text-foreground-subtle">
          Tamanho dos pontos proporcional ao numero de amostras no bin.
          Linha tracejada = calibracao perfeita.
        </p>
      </CardContent>
    </Card>
  );
}

/** Tabela ECE por Liga */
function LeagueEceTable({ rows }: { rows: LeagueEce[] }) {
  const sorted = [...rows].sort((a, b) => a.ece - b.ece);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-primary-400" />
          ECE por Liga
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/50 bg-background-surface/40">
                <th className="px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Liga
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  ECE
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Amostras
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/20">
              {sorted.map((row) => (
                <tr
                  key={row.league}
                  className="transition-colors hover:bg-card/30"
                >
                  <td className="px-3 py-2">
                    <span className="text-xs font-medium text-foreground">
                      {row.league}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={cn(
                        "font-mono text-xs font-semibold tabular-nums",
                        metricColor(row.ece, "low", 0.05),
                      )}
                    >
                      {row.ece.toFixed(4)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="font-mono text-xs text-foreground-muted tabular-nums">
                      {row.sampleSize.toLocaleString("pt-BR")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={row.ece < 0.05 ? "default" : "warning"}
                      className="text-[10px]"
                    >
                      {row.ece < 0.05 ? "Calibrado" : "Ajustar"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Componentes auxiliares
// ═══════════════════════════════════════════════════════════════════════

/** Traco em cinza para dados ausentes */
function Dash() {
  return <span className="text-xs text-foreground-subtle/50">—</span>;
}

/** Banner de erro */
function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger flex items-center gap-2">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

/** Estado vazio generico */
function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <FlaskConical className="mx-auto mb-3 h-8 w-8 text-foreground-subtle" />
        <p className="text-sm text-foreground-muted">{message}</p>
        <p className="mt-2 text-xs text-foreground-subtle">
          Os dados aparecerao aqui conforme o pipeline shadow executar previsoes.
        </p>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Skeletons
// ═══════════════════════════════════════════════════════════════════════

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function PredictionsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full rounded-2xl" />
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}

function CalibrationSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
