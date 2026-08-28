"use client";

/**
 * OddsComparisonClient — componente interativo do Comparador de Odds.
 *
 * Fluxo:
 * 1. Carrega lista de jogos agendados/ao vivo para o seletor de eventos.
 * 2. Ao selecionar um jogo, busca todas as odds atuais via API route.
 * 3. Renderiza tabelas densas (estilo trading-desk) por mercado, com
 *    uma coluna por casa de apostas e a melhor odd destacada em verde.
 * 4. Exibe badges de autorização SPA/MF e overround por casa.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Minus,
  ShieldAlert,
  ShieldCheck,
  Search,
  CalendarDays,
  ChevronDown,
  RefreshCw,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════
// Tipos locais (refletem o shape da resposta das API routes)
// ═══════════════════════════════════════════════════════════════════════

interface TeamRef {
  id: string;
  name: string;
  short_name: string;
}
interface LeagueRef {
  id: string;
  name: string;
  short_name: string;
  country_code: string | null;
}

interface EventSummary {
  id: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  round: string | null;
  venue_name: string | null;
  home_team: TeamRef;
  away_team: TeamRef;
  league: LeagueRef;
}

interface BookmakerInfo {
  id: string;
  name: string;
  slug: string;
  spaAuthorized: boolean;
  spaCompany: string | null;
  spaAuthorization: string | null;
  overround1x2: number | null;
}

/** Probabilidades justas (sem vig) calculadas pelos 3 métodos. */
interface FairProb {
  multiplicative: number;
  power: number;
  shin: number;
}

interface OddsCell {
  bookmakerId: string;
  decimalOdds: number;
  impliedProbability: number;
  previousOdds: number | null;
  changeCount: number;
  lastUpdatedAt: string;
  isBest: boolean;
  fairProb: FairProb | null;
}

interface OutcomeRow {
  id: string;
  code: string;
  name: string;
  line: number | null;
  bestOdds: number;
  bestBookmakerId: string | null;
  odds: OddsCell[];
}

interface MarketBlock {
  code: string;
  name: string;
  category: string;
  hasLine: boolean;
  key: string;
  outcomes: OutcomeRow[];
  overrounds: Record<string, number>;
}

/** Métodos de remoção de vig suportados. */
type VigMethod = "multiplicative" | "power" | "shin";

/** Formato de exibição das odds/probabilidades. */
type OddsDisplayFormat = "decimal" | "implied" | "fair";

interface ComparisonData {
  event: EventSummary & {
    homeTeam: TeamRef;
    awayTeam: TeamRef;
    league: LeagueRef;
  };
  bookmakers: BookmakerInfo[];
  markets: MarketBlock[];
}

// ═══════════════════════════════════════════════════════════════════════
// Utilitários de formatação (inline p/ evitar importação de pacote em
// client bundle — os mesmos cálculos de @betedge/utils)
// ═══════════════════════════════════════════════════════════════════════

function fmtOdds(v: number): string {
  return v.toFixed(2);
}

function fmtPercent(v: number): string {
  return (v * 100).toFixed(1).replace(".", ",") + "%";
}

function fmtOverround(v: number): string {
  const pct = (v * 100).toFixed(1).replace(".", ",");
  return v >= 0 ? `+${pct}%` : `${pct}%`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Agora";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h > 24) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h${m > 0 ? ` ${m}min` : ""}`;
  return `${m}min`;
}

// ═══════════════════════════════════════════════════════════════════════
// Componente principal
// ═══════════════════════════════════════════════════════════════════════

export function OddsComparisonClient() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOddsFormat, setShowOddsFormat] = useState<OddsDisplayFormat>("decimal");
  const [vigMethod, setVigMethod] = useState<VigMethod>("multiplicative");
  const [isEventListOpen, setIsEventListOpen] = useState(true);

  // ─── Buscar lista de jogos ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingEvents(true);
      try {
        const res = await fetch("/api/events?status=scheduled,live&limit=50");
        if (!res.ok) throw new Error("Falha ao buscar eventos");
        const { events: data } = await res.json();
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ─── Buscar odds do evento selecionado ──────────────────────────────

  const loadComparison = useCallback(async (eventId: string) => {
    setSelectedEventId(eventId);
    setLoadingComparison(true);
    setError(null);
    setIsEventListOpen(false);
    try {
      const res = await fetch(`/api/odds/comparison/${eventId}`);
      if (!res.ok) throw new Error("Falha ao buscar odds do evento");
      const data: ComparisonData = await res.json();
      setComparison(data);
    } catch (err) {
      setError((err as Error).message);
      setComparison(null);
    } finally {
      setLoadingComparison(false);
    }
  }, []);

  // ─── Filtro de busca ─────────────────────────────────────────────────

  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;
    const q = searchQuery.toLowerCase();
    return events.filter(
      (e) =>
        e.home_team.name.toLowerCase().includes(q) ||
        e.away_team.name.toLowerCase().includes(q) ||
        e.league.name.toLowerCase().includes(q) ||
        e.league.short_name.toLowerCase().includes(q),
    );
  }, [events, searchQuery]);

  // ─── Agrupar eventos por data ──────────────────────────────────────

  const groupedEvents = useMemo(() => {
    const groups = new Map<string, EventSummary[]>();
    for (const ev of filteredEvents) {
      const dateKey = new Date(ev.kickoff_at).toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        timeZone: "America/Sao_Paulo",
      });
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey)!.push(ev);
    }
    return [...groups.entries()];
  }, [filteredEvents]);

  // ═══════════════════════════════════════════════════════════════════
  // Renderização
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* ─── Seletor de evento ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-0">
          <button
            onClick={() => setIsEventListOpen(!isEventListOpen)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-foreground-subtle" />
              <CardTitle>
                {selectedEventId && comparison
                  ? `${comparison.event.homeTeam.name} vs ${comparison.event.awayTeam.name}`
                  : "Selecione um jogo"}
              </CardTitle>
              {comparison && (
                <Badge variant="secondary" className="ml-2">
                  {comparison.event.league.short_name}
                </Badge>
              )}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-foreground-subtle transition-transform",
                isEventListOpen && "rotate-180",
              )}
            />
          </button>
        </CardHeader>

        {isEventListOpen && (
          <CardContent className="pt-4">
            {/* Campo de busca */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
              <input
                type="text"
                placeholder="Buscar time, liga..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-lg border border-card-border/50 bg-background-surface/60 pl-10 pr-4 text-sm text-foreground placeholder:text-foreground-subtle focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Lista de jogos */}
            {loadingEvents ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="py-8 text-center text-sm text-foreground-subtle">
                {events.length === 0
                  ? "Nenhum jogo agendado no momento."
                  : "Nenhum jogo encontrado para a busca."}
              </div>
            ) : (
              <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
                {groupedEvents.map(([dateLabel, eventsInDay]) => (
                  <div key={dateLabel}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-subtle">
                      {dateLabel}
                    </p>
                    <div className="space-y-1">
                      {eventsInDay.map((ev) => (
                        <EventRow
                          key={ev.id}
                          event={ev}
                          isSelected={ev.id === selectedEventId}
                          onSelect={() => loadComparison(ev.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ─── Erro ───────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      )}

      {/* ─── Carregando odds ────────────────────────────────────────── */}
      {loadingComparison && <ComparisonSkeleton />}

      {/* ─── Tabelas de comparação ──────────────────────────────────── */}
      {comparison && !loadingComparison && (
        <>
          {/* Cabeçalho do evento */}
          <EventHeader event={comparison.event} />

          {/* Barra de controles: formato, método de vig, atualizar */}
          <BookmakerBar
            bookmakers={comparison.bookmakers}
            showOddsFormat={showOddsFormat}
            vigMethod={vigMethod}
            onChangeFormat={setShowOddsFormat}
            onChangeVigMethod={setVigMethod}
            onRefresh={() => loadComparison(selectedEventId!)}
          />

          {/* Tabelas por mercado */}
          {comparison.markets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-foreground-subtle">
                  Nenhuma odd disponível para este evento ainda.
                </p>
              </CardContent>
            </Card>
          ) : (
            comparison.markets.map((market) => (
              <MarketTable
                key={market.key}
                market={market}
                bookmakers={comparison.bookmakers}
                showOddsFormat={showOddsFormat}
                vigMethod={vigMethod}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Sub-componentes
// ═══════════════════════════════════════════════════════════════════════

/** Linha de evento na lista de seleção. */
function EventRow({
  event,
  isSelected,
  onSelect,
}: {
  event: EventSummary;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isLive = event.status === "live";

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors",
        isSelected
          ? "bg-primary/10 ring-1 ring-primary/30"
          : "hover:bg-card/60",
      )}
    >
      {/* Liga */}
      <div className="flex w-16 shrink-0 flex-col items-center text-center">
        <span className="text-[10px] font-medium uppercase tracking-wider text-foreground-subtle">
          {event.league.short_name}
        </span>
        {event.league.country_code && (
          <span className="text-[10px] text-foreground-subtle">
            {event.league.country_code}
          </span>
        )}
      </div>

      {/* Times */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {event.home_team.name}
        </p>
        <p className="truncate text-sm text-foreground-muted">
          {event.away_team.name}
        </p>
      </div>

      {/* Horário / status */}
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {isLive ? (
          <>
            <Badge variant="danger" className="text-[10px]">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
              AO VIVO
            </Badge>
            {event.home_score != null && (
              <span className="text-sm font-semibold text-foreground">
                {event.home_score} – {event.away_score}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-foreground">
              {fmtTime(event.kickoff_at)}
            </span>
            <span className="text-[10px] text-foreground-subtle">
              {timeUntil(event.kickoff_at)}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

/** Cabeçalho detalhado do evento selecionado. */
function EventHeader({ event }: { event: ComparisonData["event"] }) {
  const isLive = event.status === "live";

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-6 sm:flex-row sm:justify-between">
        {/* Time da casa */}
        <div className="flex-1 text-center sm:text-right">
          <p className="text-lg font-semibold text-foreground">
            {event.homeTeam.name}
          </p>
          <p className="text-xs text-foreground-subtle">Casa</p>
        </div>

        {/* Placar / horário central */}
        <div className="flex flex-col items-center gap-1">
          {isLive ? (
            <>
              <Badge variant="danger" className="mb-1">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                AO VIVO
              </Badge>
              <span className="text-3xl font-bold text-foreground">
                {event.homeScore ?? 0} – {event.awayScore ?? 0}
              </span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold text-foreground-muted">VS</span>
              <span className="text-sm font-medium text-foreground">
                {fmtDateTime(event.kickoffAt)}
              </span>
            </>
          )}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{event.league.short_name}</Badge>
            {event.round && (
              <span className="text-xs text-foreground-subtle">{event.round}</span>
            )}
          </div>
        </div>

        {/* Time visitante */}
        <div className="flex-1 text-center sm:text-left">
          <p className="text-lg font-semibold text-foreground">
            {event.awayTeam.name}
          </p>
          <p className="text-xs text-foreground-subtle">Fora</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Rótulos amigáveis dos formatos de exibição. */
const FORMAT_LABELS: Record<OddsDisplayFormat, string> = {
  decimal: "Odds Decimais",
  implied: "Prob. Implícita",
  fair: "Prob. Justa (s/ vig)",
};

/** Rótulos amigáveis dos métodos de remoção de vig. */
const VIG_METHOD_LABELS: Record<VigMethod, string> = {
  multiplicative: "Multiplicativo",
  power: "Potência",
  shin: "Shin",
};

/** Descrições curtas dos métodos de remoção de vig. */
const VIG_METHOD_DESCRIPTIONS: Record<VigMethod, string> = {
  multiplicative: "Distribui a margem proporcionalmente — mais simples, sem correção de viés",
  power: "Lei de potência — corrige viés favorito/azarão",
  shin: "Modelo Shin (1992) — modela insider trading, melhor para azarões",
};

/** Barra de casas de apostas com status SPA, controles de formato e método de vig. */
function BookmakerBar({
  bookmakers,
  showOddsFormat,
  vigMethod,
  onChangeFormat,
  onChangeVigMethod,
  onRefresh,
}: {
  bookmakers: BookmakerInfo[];
  showOddsFormat: OddsDisplayFormat;
  vigMethod: VigMethod;
  onChangeFormat: (fmt: OddsDisplayFormat) => void;
  onChangeVigMethod: (m: VigMethod) => void;
  onRefresh: () => void;
}) {
  const [vigMethodOpen, setVigMethodOpen] = useState(false);

  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground-muted">
              Casas de apostas ({bookmakers.length})
            </h3>
            <SpaLegend />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor de formato — 3 botões inline */}
            <div className="flex rounded-lg border border-card-border/50 p-0.5">
              {(["decimal", "implied", "fair"] as OddsDisplayFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => onChangeFormat(fmt)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    showOddsFormat === fmt
                      ? "bg-primary/15 text-primary-400"
                      : "text-foreground-muted hover:text-foreground",
                  )}
                >
                  {FORMAT_LABELS[fmt]}
                </button>
              ))}
            </div>

            {/* Seletor de método de vig — dropdown (visível só quando formato "fair") */}
            {showOddsFormat === "fair" && (
              <div className="relative">
                <button
                  onClick={() => setVigMethodOpen(!vigMethodOpen)}
                  className="flex items-center gap-1.5 rounded-lg border border-card-border/50 px-2.5 py-1.5 text-[11px] font-medium text-foreground-muted transition-colors hover:text-foreground"
                >
                  <span>Método: {VIG_METHOD_LABELS[vigMethod]}</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform", vigMethodOpen && "rotate-180")} />
                </button>

                {vigMethodOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setVigMethodOpen(false)} />
                    <div className="absolute right-0 top-8 z-50 w-72 rounded-xl border border-card-border/50 bg-background-surface p-1.5 shadow-glass">
                      {(["multiplicative", "power", "shin"] as VigMethod[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            onChangeVigMethod(m);
                            setVigMethodOpen(false);
                          }}
                          className={cn(
                            "flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors",
                            vigMethod === m
                              ? "bg-primary/10 text-primary-400"
                              : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
                          )}
                        >
                          <span className="text-xs font-semibold">{VIG_METHOD_LABELS[m]}</span>
                          <span className="text-[10px] text-foreground-subtle">{VIG_METHOD_DESCRIPTIONS[m]}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Botão atualizar */}
            <button
              onClick={onRefresh}
              title="Atualizar odds"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-card/60 hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Chips das casas */}
        <div className="flex flex-wrap gap-2">
          {bookmakers.map((bk) => (
            <div
              key={bk.id}
              className="flex items-center gap-1.5 rounded-lg border border-card-border/50 bg-background-surface/40 px-2.5 py-1.5"
            >
              {bk.spaAuthorized ? (
                <ShieldCheck className="h-3.5 w-3.5 text-primary-400" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5 text-warning" />
              )}
              <span className="text-xs font-medium text-foreground">{bk.name}</span>
              {bk.overround1x2 != null && (
                <span
                  className={cn(
                    "text-[10px] font-mono",
                    bk.overround1x2 <= 0.04
                      ? "text-primary-400"
                      : bk.overround1x2 <= 0.08
                        ? "text-foreground-subtle"
                        : "text-warning",
                  )}
                  title={`Margem 1x2: ${fmtOverround(bk.overround1x2)}`}
                >
                  {fmtOverround(bk.overround1x2)}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Legenda dos ícones SPA. */
function SpaLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-foreground-subtle hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-50 w-64 rounded-xl border border-card-border/50 bg-background-surface p-3 shadow-glass">
            <p className="mb-2 text-xs font-semibold text-foreground">
              Status SPA/MF
            </p>
            <div className="space-y-1.5 text-[11px] text-foreground-muted">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary-400" />
                <span>Casa autorizada pela Secretaria de Prêmios e Apostas</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
                <span>Sem autorização confirmada — verifique gov.br</span>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-foreground-subtle">
              Dados de autorização ilustrativos — valide no portal oficial do
              Ministério da Fazenda.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/** Tabela de um mercado com todas as odds por casa e overround por casa. */
function MarketTable({
  market,
  bookmakers,
  showOddsFormat,
  vigMethod,
}: {
  market: MarketBlock;
  bookmakers: BookmakerInfo[];
  showOddsFormat: OddsDisplayFormat;
  vigMethod: VigMethod;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base font-semibold text-foreground">
            {market.name}
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {market.category.replace("_", " ")}
          </Badge>
          {/* Média de overround deste mercado */}
          {Object.keys(market.overrounds).length > 0 && (() => {
            const vals = Object.values(market.overrounds);
            const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
            return (
              <span
                className={cn(
                  "text-[10px] font-mono",
                  avg <= 0.04
                    ? "text-primary-400"
                    : avg <= 0.08
                      ? "text-foreground-subtle"
                      : "text-warning",
                )}
                title={`Margem média deste mercado: ${fmtOverround(avg)}`}
              >
                Margem média: {fmtOverround(avg)}
              </span>
            );
          })()}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border/50 bg-background-surface/40">
                <th className="sticky left-0 z-10 bg-background-surface/90 backdrop-blur-sm px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-foreground-subtle">
                  Resultado
                </th>
                {bookmakers.map((bk) => {
                  const or = market.overrounds[bk.id];
                  return (
                    <th
                      key={bk.id}
                      className="min-w-[90px] px-3 py-2.5 text-center text-xs font-medium text-foreground-muted"
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="truncate">{bk.name}</span>
                        <div className="flex items-center gap-1">
                          {bk.spaAuthorized ? (
                            <ShieldCheck className="h-3 w-3 text-primary-400" />
                          ) : (
                            <ShieldAlert className="h-3 w-3 text-warning" />
                          )}
                          {or != null && (
                            <span
                              className={cn(
                                "text-[9px] font-mono",
                                or <= 0.04
                                  ? "text-primary-400"
                                  : or <= 0.08
                                    ? "text-foreground-subtle"
                                    : "text-warning",
                              )}
                              title={`Margem neste mercado: ${fmtOverround(or)}`}
                            >
                              {fmtOverround(or)}
                            </span>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
                <th className="min-w-[70px] px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-primary-400">
                  Melhor
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border/30">
              {market.outcomes.map((outcome) => (
                <tr
                  key={outcome.id}
                  className="transition-colors hover:bg-card/30"
                >
                  {/* Nome do resultado */}
                  <td className="sticky left-0 z-10 bg-background/90 backdrop-blur-sm px-4 py-3 font-medium text-foreground">
                    {outcome.name}
                    {outcome.line != null && (
                      <span className="ml-1 text-foreground-subtle">
                        ({outcome.line > 0 ? "+" : ""}
                        {outcome.line})
                      </span>
                    )}
                  </td>

                  {/* Odds por casa */}
                  {bookmakers.map((bk) => {
                    const cell = outcome.odds.find(
                      (o) => o.bookmakerId === bk.id,
                    );
                    return (
                      <td key={bk.id} className="px-3 py-3 text-center">
                        {cell ? (
                          <OddsValue
                            cell={cell}
                            showOddsFormat={showOddsFormat}
                            vigMethod={vigMethod}
                          />
                        ) : (
                          <span className="text-foreground-subtle">—</span>
                        )}
                      </td>
                    );
                  })}

                  {/* Melhor odd */}
                  <td className="px-3 py-3 text-center">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 font-mono text-sm font-bold text-primary-400">
                      <CheckCircle2 className="h-3 w-3" />
                      {showOddsFormat === "fair"
                        ? fmtPercent(1 / outcome.bestOdds)
                        : showOddsFormat === "implied"
                          ? fmtPercent(1 / outcome.bestOdds)
                          : fmtOdds(outcome.bestOdds)}
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

/** Célula individual de odd com indicador de movimento e exibição de prob. justa. */
function OddsValue({
  cell,
  showOddsFormat,
  vigMethod,
}: {
  cell: OddsCell;
  showOddsFormat: OddsDisplayFormat;
  vigMethod: VigMethod;
}) {
  // Valor exibido depende do formato selecionado
  let displayValue: string;
  if (showOddsFormat === "fair") {
    // Probabilidade justa (sem vig) pelo método selecionado
    const fp = cell.fairProb?.[vigMethod];
    displayValue = fp != null ? fmtPercent(fp) : "—";
  } else if (showOddsFormat === "implied") {
    displayValue = fmtPercent(cell.impliedProbability);
  } else {
    displayValue = fmtOdds(cell.decimalOdds);
  }

  // Indicador de movimento em relação à odd anterior
  let movement: "up" | "down" | "same" | null = null;
  if (cell.previousOdds != null) {
    if (cell.decimalOdds > cell.previousOdds) movement = "up";
    else if (cell.decimalOdds < cell.previousOdds) movement = "down";
    else movement = "same";
  }

  // Tooltip com detalhes completos
  const tooltipLines: string[] = [
    `Odd: ${fmtOdds(cell.decimalOdds)}`,
    `Prob. Implícita: ${fmtPercent(cell.impliedProbability)}`,
  ];
  if (cell.fairProb) {
    tooltipLines.push(
      `Prob. Justa (Mult.): ${fmtPercent(cell.fairProb.multiplicative)}`,
      `Prob. Justa (Potência): ${fmtPercent(cell.fairProb.power)}`,
      `Prob. Justa (Shin): ${fmtPercent(cell.fairProb.shin)}`,
    );
  }
  if (cell.previousOdds != null) {
    tooltipLines.push(`Odd anterior: ${fmtOdds(cell.previousOdds)}`);
  }
  tooltipLines.push(`Alterações: ${cell.changeCount}`);

  return (
    <div
      title={tooltipLines.join("\n")}
      className={cn(
        "relative inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-sm transition-colors",
        cell.isBest
          ? "bg-primary/15 font-bold text-primary-400 ring-1 ring-primary/30"
          : "text-foreground hover:bg-card/40",
      )}
    >
      <span>{displayValue}</span>
      {movement === "up" && (
        <ArrowUp className="h-3 w-3 text-primary-400" title="Odd subiu" />
      )}
      {movement === "down" && (
        <ArrowDown className="h-3 w-3 text-danger" title="Odd caiu" />
      )}
    </div>
  );
}

/** Skeleton de carregamento das tabelas de comparação. */
function ComparisonSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
