import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface OpportunityRowData {
  teamHome: string;
  teamAway: string;
  market: string;
  bestOdds: number;
  edge: number;
  bookmaker: string;
}

interface OpportunityRowProps {
  /** Dados da oportunidade exibida na linha. */
  opportunity: OpportunityRowData;
  /** Callback ao clicar na linha para ver detalhes. */
  onClick?: () => void;
  className?: string;
}

/**
 * Formata edge (fração, ex: 0.087) para percentual (pt-BR).
 * Ex.: 0.087 → "+8,7%", -0.015 → "-1,5%"
 */
function formatEdge(edge: number): string {
  const pct = edge * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")}%`;
}

/**
 * Linha de tabela de oportunidades.
 * Exibe confronto, mercado, odds, edge colorido, casa de apostas e seta.
 * Responsivo: colunas menos essenciais somem em telas pequenas.
 */
export function OpportunityRow({
  opportunity,
  onClick,
  className,
}: OpportunityRowProps) {
  const { teamHome, teamAway, market, bestOdds, edge, bookmaker } = opportunity;
  const isPositive = edge >= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "interactive flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors",
        "hover:bg-card-hover/60",
        className,
      )}
    >
      {/* Confronto */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {teamHome} x {teamAway}
        </p>
        <p className="mt-0.5 truncate text-xs text-foreground-subtle">{market}</p>
      </div>

      {/* Odds */}
      <span className="hidden shrink-0 text-sm font-semibold tabular-nums text-foreground sm:block">
        {bestOdds.toFixed(2)}
      </span>

      {/* Edge */}
      <span
        className={cn(
          "shrink-0 text-sm font-bold tabular-nums",
          isPositive ? "text-success" : "text-danger",
        )}
      >
        {formatEdge(edge)}
      </span>

      {/* Casa de apostas (oculta em mobile) */}
      <span className="hidden shrink-0 rounded-md bg-background-surface px-2 py-0.5 text-xs font-medium text-foreground-muted md:block">
        {bookmaker}
      </span>

      {/* Seta */}
      <ChevronRight className="h-4 w-4 shrink-0 text-foreground-subtle" />
    </button>
  );
}
