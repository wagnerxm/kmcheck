/**
 * Utilitários de formatação de números para exibição na UI (percentuais,
 * edge, odds e a nota consolidada de EdgeScore).
 */

import type { EdgeScore } from "@betedge/types";

/** Formata uma fração (0–1) como percentual em pt-BR, ex.: 0.083 → "8,3%". */
export function formatPercentage(value: number, decimals = 1): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Formata a vantagem (edge) de uma oportunidade de valor com o sinal explícito,
 * ex.: 0.083 → "+8,3%", -0.02 → "-2,0%". Útil para destacar valor positivo/negativo.
 */
export function formatEdge(value: number, decimals = 1): string {
  const formatted = formatPercentage(Math.abs(value), decimals);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

/** Formata odds decimais para exibição, ex.: 2.3 → "2.30". */
export function formatOdds(decimalOdds: number): string {
  return decimalOdds.toFixed(2);
}

/**
 * Formata a nota consolidada de EdgeScore para exibição compacta,
 * ex.: "82/100 · alto".
 */
export function formatEdgeScore(edgeScore: EdgeScore): string {
  return `${Math.round(edgeScore.value)}/100 · ${edgeScore.tier}`;
}
