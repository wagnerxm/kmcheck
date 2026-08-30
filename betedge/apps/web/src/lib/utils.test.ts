import { describe, expect, it } from "vitest";
import { formatEdge, formatOdds, formatPercentage } from "@betedge/utils/format";
import { cn } from "@/lib/utils";

/**
 * Suíte mínima da Fase 0 — garante que o pipeline de CI (lint/typecheck/test)
 * está de fato executando testes reais, cobrindo os utilitários mais usados
 * pela UI (merge de classes Tailwind e formatação de odds/edge em pt-BR).
 * Cobertura completa dos fluxos de tela chega junto das features das fases
 * seguintes do roadmap.
 */
describe("cn", () => {
  it("combina classes e resolve conflitos do Tailwind (última classe vence)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("ignora valores falsy", () => {
    expect(cn("text-sm", false, undefined, null, "font-bold")).toBe("text-sm font-bold");
  });
});

describe("formatação de odds/edge (pt-BR)", () => {
  it("formata percentuais no padrão pt-BR", () => {
    expect(formatPercentage(0.083)).toBe("8,3%");
  });

  it("formata edge positivo com sinal explícito", () => {
    expect(formatEdge(0.083)).toBe("+8,3%");
  });

  it("formata edge negativo com sinal explícito", () => {
    expect(formatEdge(-0.02)).toBe("-2,0%");
  });

  it("formata odds decimais com 2 casas", () => {
    expect(formatOdds(2.3)).toBe("2.30");
  });
});
