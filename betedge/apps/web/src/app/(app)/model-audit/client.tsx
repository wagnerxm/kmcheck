"use client";

/**
 * ModelAuditClient — componente interativo da pagina de auditoria de modelos.
 *
 * Fluxo:
 * 1. Busca eventos com odds, probabilidades justas e previsoes de modelos
 *    via API route /api/model-audit.
 * 2. Exibe resumo estatistico (cards), filtros e tabela densa estilo
 *    trading-desk com todos os dados rastreaveis.
 * 3. Cores codificadas por edge: verde (>5%), amarelo (2-5%), padrao (<2%),
 *    vermelho (negativo).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Database,
  Brain,
  BarChart3,
  Percent,
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Target,
  Trophy,
  Minus,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════
// Tipos locais (refletem o shape da resposta da API route)
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
  gradingStatus: string | null;
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

interface LeagueOption {
  id: string;
  name: string;
}

interface ModelPerf {
  modelName: string;
  modelVersion: string;
  brierScore: number | null;
  logLoss: number | null;
  calibrationError: number | null;
  clv: number | null;
  roi: number | null;
  hitRate: number | null;
  sampleSize: number;
  avgEdge: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  isWalkForward: boolean;
  periodStart: string;
  periodEnd: string;
}

interface GradingStats {
  totalActive: number;
  totalWon: number;
  totalLost: number;
  totalVoid: number;
  totalExpired: number;
  winRate: number | null;
}

interface AuditResponse {
  events: EventAudit[];
  summary: AuditSummary;
  leagues: LeagueOption[];
  modelPerformance: ModelPerf[];
  gradingStats: GradingStats;
}

type StatusFilter = "all" | "scheduled" | "finished";

// ═══════════════════════════════════════════════════════════════════════
// Utilitarios de formatacao
// ═══════════════════════════════════════════════════════════════════════

function fmtOdds(v: number): string {
  return v.toFixed(2);
}

function fmtPercent(v: number, decimals = 1): string {
  return (v * 100).toFixed(decimals).replace(".", ",") + "%";
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════════

export function ModelAuditClient() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [leagueDropdownOpen, setLeagueDropdownOpen] = useState(false);

  const LIMIT = 50;

  // ─── Buscar dados de auditoria ──────────────────────────────────────

  const loadData = useCallback(
    async (showRefresh = false) => {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("status", statusFilter);
        params.set("limit", String(LIMIT));
        params.set("offset", String(page * LIMIT));
        if (leagueFilter) params.set("leagueId", leagueFilter);
        if (searchQuery.trim()) params.set("search", searchQuery.trim());

        const res = await fetch(`/api/model-audit?${params}`);
        if (!res.ok) throw new Error("Falha ao buscar dados de auditoria");
        const json: AuditResponse = await res.json();
        setData(json);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, leagueFilter, searchQuery, page],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset da pagina ao trocar filtros
  useEffect(() => {
    setPage(0);
  }, [statusFilter, leagueFilter, searchQuery]);

  // ─── Labels dos filtros ─────────────────────────────────────────────

  const STATUS_LABELS: Record<StatusFilter, string> = {
    all: "Todos",
    scheduled: "Agendados",
    finished: "Finalizados",
  };

  const selectedLeagueName = useMemo(() => {
    if (!leagueFilter || !data) return "Todas as ligas";
    return data.leagues.find((l) => l.id === leagueFilter)?.name ?? "Todas as ligas";
  }, [leagueFilter, data]);

  // ═══════════════════════════════════════════════════════════════════
  // Renderizacao
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ─── Barra de filtros ─────────────────────────────────────── */}
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
                <span>{STATUS_LABELS[statusFilter]}</span>
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
                    {(["all", "scheduled", "finished"] as StatusFilter[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStatusFilter(s);
                          setStatusDropdownOpen(false);
                        }}
                        className={cn(
                          "flex w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          statusFilter === s
                            ? "bg-primary/10 text-primary"
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
                <span className="max-w-[180px] truncate">{selectedLeagueName}</span>
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
                        setLeagueFilter("");
                        setLeagueDropdownOpen(false);
                      }}
                      className={cn(
                        "flex w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        !leagueFilter
                          ? "bg-primary/10 text-primary"
                          : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
                      )}
                    >
                      Todas as ligas
                    </button>
                    {(data?.leagues ?? []).map((league) => (
                      <button
                        key={league.id}
                        onClick={() => {
                          setLeagueFilter(league.id);
                          setLeagueDropdownOpen(false);
                        }}
                        className={cn(
                          "flex w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                          leagueFilter === league.id
                            ? "bg-primary/10 text-primary"
                            : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
                        )}
                      >
                        {league.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Campo de busca */}
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
              <input
                type="text"
                placeholder="Buscar time..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-lg border border-card-border/50 bg-background-surface/60 pl-10 pr-4 text-sm text-foreground placeholder:text-foreground-subtle focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Botao atualizar */}
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              title="Atualizar dados"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-card-border/50 text-foreground-subtle transition-colors hover:bg-card/60 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Erro ─────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ─── Carregando ───────────────────────────────────────────── */}
      {loading && <AuditSkeleton />}

      {/* ─── Conteudo ─────────────────────────────────────────────── */}
      {data && !loading && (
        <>
          {/* Cards de resumo */}
          <SummaryCards summary={data.summary} />

          {/* Painel de Grading — resultados das oportunidades de valor */}
          <GradingPanel stats={data.gradingStats} />

          {/* Performance dos modelos (do pipeline real) */}
          {data.modelPerformance.length > 0 && (
            <ModelPerformancePanel models={data.modelPerformance} />
          )}

          {/* Tabela ou estado vazio */}
          {data.events.length === 0 ? (
            <EmptyState hasPredictions={data.summary.totalPredictions > 0} />
          ) : (
            <>
              <AuditTable events={data.events} />

              {/* Paginacao */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-foreground-subtle">
                  Exibindo {page * LIMIT + 1}–
                  {Math.min((page + 1) * LIMIT, data.summary.totalEvents)} de{" "}
                  {data.summary.totalEvents} eventos
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-card/60 hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-2 text-xs font-medium text-foreground-muted">
                    {page + 1}
                  </span>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={data.events.length < LIMIT}
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

// ═══════════════════════════════════════════════════════════════════════
// Sub-componentes
// ═══════════════════════════════════════════════════════════════════════

/** Cards de resumo estatistico no topo da pagina. */
function SummaryCards({ summary }: { summary: AuditSummary }) {
  const cards = [
    {
      label: "Eventos auditados",
      value: summary.totalEvents.toLocaleString("pt-BR"),
      icon: Database,
    },
    {
      label: "Previsoes registradas",
      value: summary.totalPredictions.toLocaleString("pt-BR"),
      icon: Brain,
    },
    {
      label: "Modelos ativos",
      value: summary.activeModels.toString(),
      icon: BarChart3,
    },
    {
      label: "Cobertura",
      value: fmtPercent(summary.coverage, 0),
      icon: Percent,
      subtitle: "eventos c/ previsao",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold text-foreground">{c.value}</p>
                <p className="truncate text-xs text-foreground-subtle">
                  {c.label}
                </p>
                {c.subtitle && (
                  <p className="text-[10px] text-foreground-subtle">
                    {c.subtitle}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** Estado vazio quando nao ha dados de previsao. */
function EmptyState({ hasPredictions }: { hasPredictions: boolean }) {
  if (hasPredictions) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Search className="mx-auto mb-3 h-8 w-8 text-foreground-subtle" />
          <p className="text-sm text-foreground-muted">
            Nenhum evento encontrado com os filtros selecionados.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-12">
        <div className="mx-auto max-w-md text-center">
          <Database className="mx-auto mb-4 h-10 w-10 text-foreground-subtle" />
          <h3 className="mb-2 text-lg font-semibold text-foreground">
            Pipeline PREDIQ conectado — aguardando dados
          </h3>
          <p className="mb-6 text-sm text-foreground-muted">
            O pipeline esta operacional. Os dados aparecerao aqui
            automaticamente apos a primeira execucao com eventos reais.
          </p>

          <div className="mx-auto max-w-xs space-y-3 text-left">
            <PipelineStep
              label="Ingestao de odds"
              status="done"
              detail="Odds sendo coletadas via SportsGameOdds"
            />
            <PipelineStep
              label="Pipeline PREDIQ"
              status="done"
              detail="5 modelos + ensemble implementados e testados"
            />
            <PipelineStep
              label="Value engine"
              status="done"
              detail="Edge, EV, Indice PREDIQ e Kelly"
            />
            <PipelineStep
              label="Grading automatico"
              status="done"
              detail="fn_outcome_won — resultado derivado, nunca inventado"
            />
            <PipelineStep
              label="Primeiros dados reais"
              status="pending"
              detail="Aguardando execucao do pipeline com eventos futuros"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Indicador de etapa do pipeline (estado vazio). */
function PipelineStep({
  label,
  status,
  detail,
}: {
  label: string;
  status: "done" | "pending" | "error";
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      {status === "done" && (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      )}
      {status === "pending" && (
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-foreground-subtle" />
      )}
      {status === "error" && (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
      )}
      <div>
        <p
          className={cn(
            "text-sm font-medium",
            status === "done"
              ? "text-success"
              : status === "error"
                ? "text-danger"
                : "text-foreground-muted",
          )}
        >
          {label}
        </p>
        <p className="text-xs text-foreground-subtle">{detail}</p>
      </div>
    </div>
  );
}

/** Tabela principal de auditoria — densa, rolavel horizontalmente. */
function AuditTable({ events }: { events: EventAudit[] }) {
  // Expandir linhas: cada evento pode ter multiplos mercados/outcomes.
  // Achata tudo em linhas de tabela para visualizacao densa.
  const rows = useMemo(() => {
    const result: FlatRow[] = [];
    for (const ev of events) {
      if (ev.markets.length === 0) {
        // Evento sem odds ainda — mostra linha basica
        result.push({
          event: ev.event,
          marketName: null,
          outcome: null,
          isFirstOfEvent: true,
          eventRowSpan: 1,
        });
      } else {
        let totalRows = 0;
        for (const m of ev.markets) {
          totalRows += m.outcomes.length || 1;
        }
        let isFirst = true;
        for (const market of ev.markets) {
          if (market.outcomes.length === 0) {
            result.push({
              event: ev.event,
              marketName: market.marketName,
              outcome: null,
              isFirstOfEvent: isFirst,
              eventRowSpan: isFirst ? totalRows : 0,
            });
            isFirst = false;
          } else {
            for (const outcome of market.outcomes) {
              result.push({
                event: ev.event,
                marketName: market.marketName,
                outcome,
                isFirstOfEvent: isFirst,
                eventRowSpan: isFirst ? totalRows : 0,
              });
              isFirst = false;
            }
          }
        }
      }
    }
    return result;
  }, [events]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <CardTitle className="text-base">Dados de Auditoria</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/50 bg-background-surface/40">
                {/* Grupo: Evento */}
                <th
                  colSpan={5}
                  className="border-b border-r border-card-border/30 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-foreground-subtle"
                >
                  Evento
                </th>
                {/* Grupo: Mercado */}
                <th
                  colSpan={2}
                  className="border-b border-r border-card-border/30 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-foreground-subtle"
                >
                  Mercado
                </th>
                {/* Grupo: Odds */}
                <th
                  colSpan={3}
                  className="border-b border-r border-card-border/30 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-foreground-subtle"
                >
                  Odds
                </th>
                {/* Grupo: Probabilidades */}
                <th
                  colSpan={3}
                  className="border-b border-r border-card-border/30 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-foreground-subtle"
                >
                  Probabilidades
                </th>
                {/* Grupo: Modelo */}
                <th
                  colSpan={4}
                  className="border-b border-r border-card-border/30 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-foreground-subtle"
                >
                  Modelo
                </th>
                {/* Grupo: Value */}
                <th
                  colSpan={4}
                  className="border-b border-card-border/30 px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-foreground-subtle"
                >
                  Value
                </th>
              </tr>
              <tr className="border-b border-card-border/50 bg-background-surface/40">
                {/* Evento */}
                <th className="sticky left-0 z-10 bg-background-surface/90 backdrop-blur-sm min-w-[60px] px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Liga
                </th>
                <th className="min-w-[160px] px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Partida
                </th>
                <th className="min-w-[100px] px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Data/Hora
                </th>
                <th className="min-w-[70px] px-2 py-2 text-center text-xs font-semibold text-foreground-subtle">
                  Status
                </th>
                <th className="min-w-[50px] border-r border-card-border/30 px-2 py-2 text-center text-xs font-semibold text-foreground-subtle">
                  Placar
                </th>
                {/* Mercado */}
                <th className="min-w-[80px] px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Mercado
                </th>
                <th className="min-w-[80px] border-r border-card-border/30 px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Resultado
                </th>
                {/* Odds */}
                <th className="min-w-[90px] px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Bookmaker
                </th>
                <th className="min-w-[55px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Odd
                </th>
                <th className="min-w-[90px] border-r border-card-border/30 px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Timestamp
                </th>
                {/* Probabilidades */}
                <th className="min-w-[70px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  P. Impl.
                </th>
                <th className="min-w-[70px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Overround
                </th>
                <th className="min-w-[70px] border-r border-card-border/30 px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  P. Justa
                </th>
                {/* Modelo */}
                <th className="min-w-[70px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  P. Modelo
                </th>
                <th className="min-w-[60px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Odd Justa
                </th>
                <th className="min-w-[80px] px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Versao
                </th>
                <th className="min-w-[80px] border-r border-card-border/30 px-2 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Features
                </th>
                {/* Value */}
                <th className="min-w-[60px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Edge
                </th>
                <th className="min-w-[55px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  EV
                </th>
                <th className="min-w-[60px] px-2 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  PREDIQ
                </th>
                <th className="min-w-[70px] px-2 py-2 text-center text-xs font-semibold text-foreground-subtle">
                  Grading
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/20">
              {rows.map((row, i) => (
                <AuditRow key={`${row.event.id}-${i}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Linha da tabela
// ═══════════════════════════════════════════════════════════════════════

interface FlatRow {
  event: EventAudit["event"];
  marketName: string | null;
  outcome: OutcomeAudit | null;
  isFirstOfEvent: boolean;
  eventRowSpan: number;
}

function AuditRow({ row }: { row: FlatRow }) {
  const { event, marketName, outcome } = row;

  // Dados do melhor bookmaker (maior odd) para exibir na linha
  const bestBk =
    outcome?.bookmakers?.reduce<BookmakerOdd | null>(
      (best, bk) => (!best || bk.odds > best.odds ? bk : best),
      null,
    ) ?? null;

  // Modelo primario (primeiro da lista)
  const primaryPred = outcome?.modelPredictions?.[0] ?? null;

  // Cor do edge
  const edgeColor = getEdgeColor(outcome?.edge ?? null);

  return (
    <tr className="transition-colors hover:bg-card/30">
      {/* ── Colunas do evento (apenas na 1a linha do grupo) ── */}
      {row.isFirstOfEvent && (
        <>
          <td
            rowSpan={row.eventRowSpan}
            className="sticky left-0 z-10 bg-background/90 backdrop-blur-sm border-r border-card-border/10 px-2 py-2 align-top"
          >
            <Badge variant="outline" className="text-[10px] whitespace-nowrap">
              {event.league}
            </Badge>
          </td>
          <td rowSpan={row.eventRowSpan} className="px-2 py-2 align-top">
            <p className="text-sm font-medium text-foreground whitespace-nowrap">
              {event.homeTeam}
            </p>
            <p className="text-xs text-foreground-muted whitespace-nowrap">
              {event.awayTeam}
            </p>
          </td>
          <td rowSpan={row.eventRowSpan} className="px-2 py-2 align-top">
            <span className="text-xs text-foreground-muted whitespace-nowrap">
              {fmtDateTime(event.kickoffAt)}
            </span>
          </td>
          <td
            rowSpan={row.eventRowSpan}
            className="px-2 py-2 text-center align-top"
          >
            <StatusBadge status={event.status} />
          </td>
          <td
            rowSpan={row.eventRowSpan}
            className="border-r border-card-border/30 px-2 py-2 text-center align-top"
          >
            {event.status === "finished" &&
            event.homeScore != null &&
            event.awayScore != null ? (
              <span className="text-sm font-semibold text-foreground">
                {event.homeScore}–{event.awayScore}
              </span>
            ) : (
              <span className="text-xs text-foreground-subtle">—</span>
            )}
          </td>
        </>
      )}

      {/* ── Mercado / Resultado ── */}
      <td className="px-2 py-2">
        {marketName ? (
          <span className="text-xs font-medium text-foreground whitespace-nowrap">
            {marketName}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="border-r border-card-border/30 px-2 py-2">
        {outcome ? (
          <span className="text-xs text-foreground whitespace-nowrap">
            {outcome.outcomeName}
          </span>
        ) : (
          <Dash />
        )}
      </td>

      {/* ── Odds (melhor bookmaker) ── */}
      <td className="px-2 py-2">
        {bestBk ? (
          <span className="text-xs text-foreground-muted whitespace-nowrap">
            {bestBk.bookmakerName}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {bestBk ? (
          <span className="font-mono text-xs font-medium text-foreground">
            {fmtOdds(bestBk.odds)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="border-r border-card-border/30 px-2 py-2 text-right">
        {bestBk?.timestamp ? (
          <span className="text-[10px] text-foreground-subtle whitespace-nowrap">
            {fmtShortDate(bestBk.timestamp)}
          </span>
        ) : (
          <Dash />
        )}
      </td>

      {/* ── Probabilidades ── */}
      <td className="px-2 py-2 text-right">
        {bestBk ? (
          <span className="font-mono text-xs text-foreground-muted">
            {fmtPercent(bestBk.impliedProbability)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {outcome ? (
          <span
            className={cn(
              "font-mono text-xs",
              outcome.overround > 1.08
                ? "text-warning"
                : outcome.overround > 1.04
                  ? "text-foreground-subtle"
                  : "text-success",
            )}
          >
            {fmtPercent(outcome.overround - 1)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="border-r border-card-border/30 px-2 py-2 text-right">
        {outcome?.fairProbability != null ? (
          <span className="font-mono text-xs font-medium text-foreground">
            {fmtPercent(outcome.fairProbability)}
          </span>
        ) : (
          <Dash />
        )}
      </td>

      {/* ── Modelo ── */}
      <td className="px-2 py-2 text-right">
        {primaryPred ? (
          <span className="font-mono text-xs font-medium text-foreground">
            {fmtPercent(primaryPred.probability)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {primaryPred ? (
          <span className="font-mono text-xs text-foreground-muted">
            {fmtOdds(primaryPred.fairOdds)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-2">
        {primaryPred ? (
          <span className="text-[10px] text-foreground-subtle whitespace-nowrap">
            {primaryPred.modelName} v{primaryPred.modelVersion}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="border-r border-card-border/30 px-2 py-2">
        {primaryPred?.featuresSnapshot ? (
          <span
            className="text-[10px] text-foreground-subtle cursor-help"
            title={JSON.stringify(primaryPred.featuresSnapshot, null, 2)}
          >
            {primaryPred.modelType}
          </span>
        ) : (
          <Dash />
        )}
      </td>

      {/* ── Value ── */}
      <td className="px-2 py-2 text-right">
        {outcome?.edge != null ? (
          <span className={cn("font-mono text-xs font-semibold", edgeColor)}>
            {outcome.edge >= 0 ? "+" : ""}
            {fmtPercent(outcome.edge)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {outcome?.ev != null ? (
          <span
            className={cn(
              "font-mono text-xs",
              outcome.ev > 0 ? "text-success" : "text-danger",
            )}
          >
            {outcome.ev >= 0 ? "+" : ""}
            {fmtPercent(outcome.ev)}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {outcome?.prediqIndex != null ? (
          <PrediqBadge value={outcome.prediqIndex} />
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-2 py-2 text-center">
        {outcome?.gradingStatus ? (
          <GradingBadge status={outcome.gradingStatus} />
        ) : (
          <Dash />
        )}
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Micro-componentes
// ═══════════════════════════════════════════════════════════════════════

/** Traco em cinza para dados ausentes. */
function Dash() {
  return <span className="text-xs text-foreground-subtle/50">—</span>;
}

/** Badge de status do evento. */
function StatusBadge({ status }: { status: string }) {
  if (status === "finished") {
    return (
      <Badge variant="secondary" className="text-[10px]">
        Finalizado
      </Badge>
    );
  }
  if (status === "live") {
    return (
      <Badge variant="danger" className="text-[10px]">
        <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
        Ao vivo
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      Agendado
    </Badge>
  );
}

/** Badge de resultado do grading (won/lost/void/active). */
function GradingBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "secondary" | "danger" | "outline" }> = {
    active: { label: "Ativa", variant: "outline" },
    result_won: { label: "✓ Acertou", variant: "secondary" },
    result_lost: { label: "✗ Errou", variant: "danger" },
    result_void: { label: "Void", variant: "outline" },
    expired: { label: "Expirada", variant: "outline" },
    odds_moved: { label: "Odds mov.", variant: "outline" },
    removed: { label: "Removida", variant: "outline" },
  };

  const c = config[status] ?? { label: status, variant: "outline" as const };

  return (
    <Badge variant={c.variant} className="text-[10px] whitespace-nowrap">
      {c.label}
    </Badge>
  );
}

/** Badge visual para o Indice PREDIQ (0-100). */
function PrediqBadge({ value }: { value: number }) {
  const color =
    value >= 70
      ? "text-success"
      : value >= 40
        ? "text-warning"
        : "text-foreground-muted";

  return (
    <span className={cn("font-mono text-xs font-bold", color)}>
      {value.toFixed(0)}
    </span>
  );
}

/** Retorna a classe de cor baseada no valor do edge. */
function getEdgeColor(edge: number | null): string {
  if (edge == null) return "text-foreground-subtle";
  if (edge < 0) return "text-danger";
  if (edge >= 0.05) return "text-success";
  if (edge >= 0.02) return "text-warning";
  return "text-foreground";
}

// ═══════════════════════════════════════════════════════════════════════
// Painel de Grading — resultados de value opportunities
// ═══════════════════════════════════════════════════════════════════════

function GradingPanel({ stats }: { stats: GradingStats }) {
  const total = stats.totalWon + stats.totalLost + stats.totalVoid + stats.totalActive + stats.totalExpired;
  if (total === 0) return null;

  const resolved = stats.totalWon + stats.totalLost;

  const cards = [
    {
      label: "Ativas",
      value: stats.totalActive,
      icon: Activity,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "Acertadas",
      value: stats.totalWon,
      icon: Trophy,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      label: "Erradas",
      value: stats.totalLost,
      icon: XCircle,
      color: "text-danger",
      bgColor: "bg-danger/10",
    },
    {
      label: "Void/Expiradas",
      value: stats.totalVoid + stats.totalExpired,
      icon: Minus,
      color: "text-foreground-subtle",
      bgColor: "bg-background-surface",
    },
    {
      label: "Win Rate",
      value: stats.winRate != null ? fmtPercent(stats.winRate, 1) : "—",
      icon: Target,
      color: stats.winRate != null && stats.winRate > 0.5 ? "text-success" : "text-warning",
      bgColor: stats.winRate != null && stats.winRate > 0.5 ? "bg-success/10" : "bg-warning/10",
      subtitle: resolved > 0 ? `${resolved} resolvidas` : undefined,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-primary" />
          Grading — Resultado das Oportunidades
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className="flex items-center gap-3 rounded-xl border border-card-border/30 p-3">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", c.bgColor)}>
                  <Icon className={cn("h-4 w-4", c.color)} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-foreground">
                    {typeof c.value === "number" ? c.value.toLocaleString("pt-BR") : c.value}
                  </p>
                  <p className="truncate text-[10px] text-foreground-subtle">{c.label}</p>
                  {c.subtitle && (
                    <p className="text-[9px] text-foreground-subtle">{c.subtitle}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Performance dos modelos (dados reais do pipeline)
// ═══════════════════════════════════════════════════════════════════════

function ModelPerformancePanel({ models }: { models: ModelPerf[] }) {
  // Agrupar pela versao mais recente de cada modelo
  const latestByModel = new Map<string, ModelPerf>();
  for (const m of models) {
    const key = `${m.modelName}:${m.modelVersion}`;
    const existing = latestByModel.get(key);
    if (!existing || m.periodEnd > existing.periodEnd) {
      latestByModel.set(key, m);
    }
  }

  const perf = [...latestByModel.values()].sort((a, b) => {
    // Ordenar por Brier (menor = melhor)
    if (a.brierScore != null && b.brierScore != null) return a.brierScore - b.brierScore;
    if (a.brierScore != null) return -1;
    if (b.brierScore != null) return 1;
    return 0;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-primary" />
          Performance dos Modelos — Walk-Forward
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/50 bg-background-surface/40">
                <th className="px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Modelo
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Brier ↓
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Log Loss
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  ECE
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Hit Rate
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  CLV
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  ROI
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Sharpe
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  Max DD
                </th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-foreground-subtle">
                  N
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-foreground-subtle">
                  Periodo
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/20">
              {perf.map((m) => (
                <tr key={`${m.modelName}:${m.modelVersion}`} className="transition-colors hover:bg-card/30">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="text-xs font-medium text-foreground">
                      {m.modelName}
                    </span>
                    <span className="ml-1 text-[10px] text-foreground-subtle">
                      v{m.modelVersion}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.brierScore} format="fixed4" good="low" threshold={0.25} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.logLoss} format="fixed4" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.calibrationError} format="fixed4" good="low" threshold={0.05} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.hitRate} format="percent" good="high" threshold={0.5} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.clv} format="percent" good="high" threshold={0} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.roi} format="percent" good="high" threshold={0} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.sharpeRatio} format="fixed2" good="high" threshold={0} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <MetricCell value={m.maxDrawdown} format="percent" good="low" threshold={0.2} invert />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      "font-mono text-xs",
                      m.sampleSize >= 200 ? "text-foreground" : "text-warning",
                    )}>
                      {m.sampleSize.toLocaleString("pt-BR")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] text-foreground-subtle whitespace-nowrap">
                      {fmtShortDate(m.periodStart)} — {fmtShortDate(m.periodEnd)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {perf.length === 0 && (
          <p className="py-8 text-center text-sm text-foreground-subtle">
            Nenhuma metrica de performance disponivel. Execute o pipeline para gerar dados.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Celula de metrica com coloracao semantica. */
function MetricCell({
  value,
  format,
  good,
  threshold,
  invert,
}: {
  value: number | null;
  format: "fixed2" | "fixed4" | "percent";
  good?: "low" | "high";
  threshold?: number;
  invert?: boolean;
}) {
  if (value == null) return <Dash />;

  let formatted: string;
  if (format === "percent") {
    formatted = fmtPercent(value, 1);
  } else if (format === "fixed2") {
    formatted = value.toFixed(2);
  } else {
    formatted = value.toFixed(4);
  }

  let color = "text-foreground";
  if (good && threshold != null) {
    const v = invert ? -value : value;
    const t = invert ? -threshold : threshold;
    if (good === "low") {
      color = v <= t ? "text-success" : v <= t * 1.5 ? "text-warning" : "text-danger";
    } else {
      color = v >= t ? "text-success" : "text-danger";
    }
  }

  return <span className={cn("font-mono text-xs", color)}>{formatted}</span>;
}

/** Skeleton de carregamento. */
function AuditSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-2xl" />
      <Skeleton className="h-96 w-full rounded-2xl" />
    </div>
  );
}
