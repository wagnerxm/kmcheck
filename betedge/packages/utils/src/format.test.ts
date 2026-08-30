/**
 * Testes unitários das funções de formatação.
 */

import { describe, expect, it } from "vitest";
import {
  formatPercentage,
  formatEdge,
  formatOdds,
  formatOverround,
  overroundSeverity,
} from "./format";

describe("formatPercentage", () => {
  it("formata fração como percentual pt-BR", () => {
    expect(formatPercentage(0.5)).toBe("50,0%");
    expect(formatPercentage(0.083)).toBe("8,3%");
    expect(formatPercentage(1)).toBe("100,0%");
  });

  it("respeita casas decimais personalizadas", () => {
    expect(formatPercentage(0.083, 2)).toBe("8,30%");
    expect(formatPercentage(0.083, 0)).toBe("8%");
  });
});

describe("formatEdge", () => {
  it("edge positivo mostra sinal +", () => {
    expect(formatEdge(0.083)).toBe("+8,3%");
  });

  it("edge negativo mostra sinal -", () => {
    expect(formatEdge(-0.02)).toBe("-2,0%");
  });

  it("edge zero não tem sinal", () => {
    expect(formatEdge(0)).toBe("0,0%");
  });
});

describe("formatOdds", () => {
  it("formata odds decimais com 2 casas", () => {
    expect(formatOdds(2.3)).toBe("2.30");
    expect(formatOdds(1.5)).toBe("1.50");
    expect(formatOdds(10)).toBe("10.00");
  });
});

describe("formatOverround", () => {
  it("margem positiva com sinal +", () => {
    expect(formatOverround(0.053)).toBe("+5,3%");
  });

  it("margem negativa com sinal -", () => {
    expect(formatOverround(-0.01)).toBe("-1,0%");
  });

  it("margem zero com sinal +", () => {
    expect(formatOverround(0)).toBe("+0,0%");
  });
});

describe("overroundSeverity", () => {
  it("margem ≤ 4% → low", () => {
    expect(overroundSeverity(0.03)).toBe("low");
    expect(overroundSeverity(0.04)).toBe("low");
  });

  it("margem ≤ 8% → medium", () => {
    expect(overroundSeverity(0.05)).toBe("medium");
    expect(overroundSeverity(0.08)).toBe("medium");
  });

  it("margem > 8% → high", () => {
    expect(overroundSeverity(0.09)).toBe("high");
    expect(overroundSeverity(0.15)).toBe("high");
  });
});
