"use client";

import { cn } from "@/lib/utils";
import { ConfidenceGauge } from "@/components/ui/confidence-gauge";

interface OpportunityData {
  teamHome: string;
  teamAway: string;
  league: string;
  market: string;
  edge: number;
  ev: number;
  bestOdds: number;
  prediqScore: number;
  confidence: number;
}

interface OpportunityHeroProps {
  /** Dados da oportunidade em destaque, ou null para estado vazio. */
  opportunity: OpportunityData | null;
  className?: string;
}

/**
 * Formata número com vírgula como separador decimal (pt-BR).
 * Ex.: 8.7 → "8,7"
 */
/**
 * Formata edge (fração, ex: 0.087) para exibição em pontos percentuais.
 * Ex.: 0.087 → "+8,7 p.p."
 */
function formatEdge(edge: number): string {
  const pct = edge * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")} p.p.`;
}

/**
 * Card hero para a principal oportunidade identificada.
 * Layout amplo com destaque vermelho, edge em fonte display grande,
 * nomes dos times e gauge de confiança à direita.
 */
export function OpportunityHero({ opportunity, className }: OpportunityHeroProps) {
  if (!opportunity) {
    return (
      <div className={cn("card-premium flex items-center justify-center p-8", className)}>
        <p className="text-sm text-foreground-muted">
          Nenhuma oportunidade atingiu os critérios neste momento.
        </p>
      </div>
    );
  }

  const { teamHome, teamAway, league, market, edge, confidence } = opportunity;

  return (
    <div className={cn("card-accent p-5", className)}>
      <div className="flex items-start gap-6">
        {/* Seção esquerda: destaque de edge */}
        <div className="flex-1 space-y-3">
          {/* Tag */}
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            Vantagem em Destaque
          </p>

          {/* Edge em valor grande */}
          <p className="font-display text-display-lg text-foreground">
            {formatEdge(edge)}
          </p>

          {/* Explicação */}
          <p className="text-xs text-foreground-muted">
            Nossa projeção aponta valor acima da linha do mercado.
          </p>

          {/* Confronto */}
          <div className="pt-2">
            <p className="text-sm font-semibold text-foreground">
              {teamHome}
              <span className="mx-2 text-foreground-muted">vs</span>
              {teamAway}
            </p>
            <p className="mt-0.5 text-sm text-foreground-muted">
              {teamHome} x {teamAway} &bull; {market}
            </p>
          </div>
        </div>

        {/* Seção direita: gauge de confiança */}
        <div className="shrink-0">
          <ConfidenceGauge value={confidence} size="md" />
        </div>
      </div>
    </div>
  );
}
