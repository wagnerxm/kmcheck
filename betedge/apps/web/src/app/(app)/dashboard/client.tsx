"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Calendar, Dribbble, Target, TrendingUp, ChevronRight,
  BarChart3, Activity, AlertCircle, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { SportFilter } from "@/components/ui/sport-filter";
import { DateSelector } from "@/components/ui/date-selector";
import { MetricCard } from "@/components/ui/metric-card";
import { OpportunityHero } from "@/components/ui/opportunity-hero";
import { OpportunityRow } from "@/components/ui/opportunity-row";
import { EmptyState } from "@/components/ui/empty-state";
import { PrediqScoreGauge } from "@/components/ui/prediq-score-gauge";

/* ===== Tipos ===== */

interface Opportunity {
  id: string;
  teamHome: string;
  teamAway: string;
  league: string;
  market: string;
  edge: number;
  ev: number;
  bestOdds: number;
  prediqScore: number;
  confidence: number;
  bookmaker: string;
  kickoff?: string;
}

interface ShadowMetrics {
  brier?: number;
  clv?: number;
  ece?: number;
  roi?: number;
  totalPredictions?: number;
  totalSelections?: number;
  engineAvailable?: boolean;
}

interface DashboardData {
  opportunities: Opportunity[];
  metrics: ShadowMetrics;
  isLoading: boolean;
  error: string | null;
}

/* ===== Filtros de esporte ===== */

const SPORT_FILTERS = [
  { id: "today", label: "Hoje", icon: Calendar },
  { id: "futebol", label: "Futebol", icon: Dribbble },
  { id: "basquete", label: "Basquete" },
  { id: "tenis", label: "Tênis" },
];

/* ===== Saudação por horário ===== */

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/* ===== Formatação pt-BR ===== */

function fmtDecimal(v: number, digits = 1): string {
  return v.toFixed(digits).replace(".", ",");
}

function fmtPct(v: number, digits = 1): string {
  return `${v >= 0 ? "+" : ""}${fmtDecimal(v * 100, digits)}%`;
}

function fmtEdge(v: number): string {
  return `${v >= 0 ? "+" : ""}${fmtDecimal(v * 100, 1)} p.p.`;
}

function fmtOdds(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

/* ===== Hook de dados ===== */

function useDashboardData(): DashboardData {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [metrics, setMetrics] = useState<ShadowMetrics>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Buscar oportunidades do model-audit (value_opportunities).
      const [auditRes, metricsRes] = await Promise.allSettled([
        fetch("/api/model-audit"),
        fetch("/api/shadow-lab?view=overview"),
      ]);

      // Oportunidades
      if (auditRes.status === "fulfilled" && auditRes.value.ok) {
        const data = await auditRes.value.json();
        const events = data.events ?? [];
        const mapped: Opportunity[] = [];

        for (const ev of events) {
          if (!ev.value_opportunities?.length) continue;
          for (const vo of ev.value_opportunities) {
            if ((vo.edge ?? 0) <= 0) continue;
            mapped.push({
              id: `${ev.event_id}-${vo.market}-${vo.outcome}`,
              teamHome: ev.home_team ?? "Time A",
              teamAway: ev.away_team ?? "Time B",
              league: ev.league ?? "",
              market: vo.market ?? "",
              edge: vo.edge ?? 0,
              ev: vo.ev ?? 0,
              bestOdds: vo.best_odds ?? 0,
              prediqScore: vo.edge_score ?? 0,
              confidence: Math.min(100, Math.round((vo.edge_score ?? 0))),
              bookmaker: vo.bookmaker ?? "",
              kickoff: ev.kickoff,
            });
          }
        }

        // Ordenar por edge_score (PREDIQ Score) decrescente.
        mapped.sort((a, b) => b.prediqScore - a.prediqScore);
        setOpportunities(mapped);
      }

      // Métricas do Shadow Lab
      if (metricsRes.status === "fulfilled" && metricsRes.value.ok) {
        const data = await metricsRes.value.json();
        setMetrics({
          brier: data.brier_score,
          clv: data.mean_clv_price,
          ece: data.ece,
          roi: data.theoretical_roi,
          totalPredictions: data.total_predictions,
          totalSelections: data.total_selections,
          engineAvailable: data._engineAvailable !== false,
        });
      }
    } catch {
      setError("Não foi possível carregar os dados.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { opportunities, metrics, isLoading, error };
}

/* ===== Componente principal ===== */

export function DashboardClient() {
  const [sportFilter, setSportFilter] = useState("today");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const { opportunities, metrics, isLoading, error } = useDashboardData();

  // Melhor oportunidade para o hero card.
  const heroOpp = opportunities.length > 0 ? opportunities[0] : null;

  // Top 5 oportunidades para a lista (excluindo o hero).
  const topOpps = opportunities.slice(1, 6);

  // KPIs derivados das oportunidades.
  const bestEv = useMemo(() => {
    if (!opportunities.length) return null;
    return Math.max(...opportunities.map((o) => o.ev));
  }, [opportunities]);

  const bestOdds = useMemo(() => {
    if (!opportunities.length) return null;
    const best = opportunities.reduce((a, b) => (a.bestOdds > b.bestOdds ? a : b));
    return { value: best.bestOdds, bookmaker: best.bookmaker };
  }, [opportunities]);

  const bestScore = useMemo(() => {
    if (!opportunities.length) return null;
    return Math.max(...opportunities.map((o) => o.prediqScore));
  }, [opportunities]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ===== Saudação + Título ===== */}
      <div className="pt-1">
        <p className="text-sm text-foreground-muted">{getGreeting()}, Analista</p>
        <h1 className="font-display text-display-xl uppercase tracking-tight text-foreground">
          Oportunidades
        </h1>
        <p className="mt-0.5 text-sm text-foreground-subtle">
          As melhores leituras quantitativas para hoje.
        </p>
      </div>

      {/* ===== Filtros de esporte ===== */}
      <SportFilter
        options={SPORT_FILTERS}
        selected={sportFilter}
        onChange={setSportFilter}
      />

      {/* ===== Calendário horizontal ===== */}
      <DateSelector selected={selectedDate} onChange={setSelectedDate} />

      {/* ===== Estado de erro ===== */}
      {error && (
        <div className="card-premium flex items-center gap-3 p-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-danger" />
          <p className="text-sm text-foreground-muted">{error}</p>
        </div>
      )}

      {/* ===== Loading ===== */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-foreground-subtle">Carregando oportunidades…</p>
        </div>
      )}

      {/* ===== Conteúdo principal ===== */}
      {!isLoading && !error && (
        <>
          {/* Hero — Oportunidade em destaque */}
          <OpportunityHero opportunity={heroOpp} />

          {/* KPIs principais — 3 cards */}
          <div className="grid grid-cols-3 gap-3">
            <MetricCard
              label="Valor Esperado"
              value={bestEv != null ? fmtPct(bestEv) : "—"}
              variant={bestEv != null && bestEv > 0 ? "accent" : "default"}
            />
            <MetricCard
              label="Melhor Odd"
              value={bestOdds ? fmtOdds(bestOdds.value) : "—"}
              subtitle={bestOdds?.bookmaker || undefined}
            />
            <div className="card-premium flex flex-col items-center justify-center gap-1 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                Score
              </span>
              <PrediqScoreGauge
                score={bestScore ?? 0}
                size="sm"
              />
            </div>
          </div>

          {/* Top Oportunidades */}
          <div>
            <SectionHeader
              title="Top Oportunidades"
              action={
                opportunities.length > 5
                  ? { label: "Ver Todas", onClick: () => {} }
                  : undefined
              }
            />
            <div className="mt-3 space-y-2">
              {topOpps.length > 0 ? (
                topOpps.map((opp) => (
                  <OpportunityRow key={opp.id} opportunity={opp} />
                ))
              ) : (
                <EmptyState
                  icon={Target}
                  title="Nenhuma oportunidade disponível"
                  description="As oportunidades aparecerão aqui quando o motor estatístico detectar valor."
                />
              )}
            </div>
          </div>

          {/* Movimento das Odds */}
          <div>
            <SectionHeader title="Movimento das Odds" />
            <div className="mt-3 card-premium p-4">
              {heroOpp ? (
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    {/* Placeholder para gráfico de odds — dados do odds_history */}
                    <div className="flex h-24 items-center justify-center rounded-lg bg-background/50">
                      <Activity className="h-5 w-5 text-foreground-subtle" />
                    </div>
                  </div>
                  <div className="ml-4 text-right">
                    <p className="text-xs font-medium uppercase tracking-wider text-primary">
                      {heroOpp.teamHome} x {heroOpp.teamAway}
                    </p>
                    <p className="mt-1 font-display text-xl font-bold text-foreground">
                      {fmtOdds(heroOpp.bestOdds)}
                    </p>
                    <p className="text-xs text-success">
                      {fmtEdge(heroOpp.edge)}
                    </p>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={Activity}
                  title="Sem movimentos registrados"
                  description="O histórico de odds aparecerá aqui."
                />
              )}
            </div>
          </div>

          {/* Desempenho do Modelo */}
          <div>
            <SectionHeader title="Desempenho do Modelo" />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label="Brier"
                value={metrics.brier != null ? fmtDecimal(metrics.brier, 3) : "—"}
                subtitle={metrics.brier != null ? "Baixo é melhor" : "Amostra em coleta"}
                variant="compact"
              />
              <MetricCard
                label="CLV"
                value={metrics.clv != null ? fmtPct(metrics.clv) : "—"}
                subtitle={metrics.clv != null ? "Valor capturado" : "Amostra em coleta"}
                variant="compact"
              />
              <MetricCard
                label="ECE"
                value={metrics.ece != null ? fmtDecimal(metrics.ece, 3) : "—"}
                subtitle={metrics.ece != null ? "Calibração" : "Amostra em coleta"}
                variant="compact"
              />
              <MetricCard
                label="Confiança"
                value={
                  metrics.totalPredictions != null && metrics.totalPredictions > 0
                    ? `${Math.min(100, Math.round((metrics.totalPredictions / 200) * 100))}%`
                    : "—"
                }
                subtitle={
                  metrics.totalPredictions != null && metrics.totalPredictions > 0
                    ? "Base crescente"
                    : "Amostra em coleta"
                }
                variant="compact"
              />
            </div>
            {(metrics.totalPredictions == null || metrics.totalPredictions < 200) && (
              <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-foreground-subtle">
                ⚠️ Amostra ainda não significativa
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
