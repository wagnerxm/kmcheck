/**
 * Testes unitários das funções de conversão de odds.
 *
 * NOTA: Funções de cálculo quantitativo (remoção de vig, overround,
 * fairProbabilities, fairOdds) foram REMOVIDAS do módulo odds.ts.
 * Python é a única fonte oficial de toda matemática quantitativa.
 * Os testes dessas funções removidas foram removidos junto com elas.
 * Ver: PYTHON_TS_CONVERGENCE_REPORT.md
 */

import { describe, expect, it } from "vitest";
import {
  decimalToImplied,
  impliedToDecimal,
  decimalToAmerican,
  americanToDecimal,
  decimalToFractional,
} from "./odds";

// ═══════════════════════════════════════════════════════════════════════════
// Conversões básicas (mantidas — formato, não cálculo quantitativo)
// ═══════════════════════════════════════════════════════════════════════════

describe("decimalToImplied", () => {
  it("converte odds decimais em probabilidade implícita", () => {
    expect(decimalToImplied(2.0)).toBeCloseTo(0.5, 6);
    expect(decimalToImplied(4.0)).toBeCloseTo(0.25, 6);
    expect(decimalToImplied(1.5)).toBeCloseTo(2 / 3, 6);
  });

  it("lança erro para odds ≤ 1", () => {
    expect(() => decimalToImplied(1.0)).toThrow();
    expect(() => decimalToImplied(0.5)).toThrow();
  });
});

describe("impliedToDecimal", () => {
  it("converte probabilidade em odds decimais", () => {
    expect(impliedToDecimal(0.5)).toBeCloseTo(2.0, 6);
    expect(impliedToDecimal(0.25)).toBeCloseTo(4.0, 6);
  });

  it("lança erro para probabilidade fora de (0, 1]", () => {
    expect(() => impliedToDecimal(0)).toThrow();
    expect(() => impliedToDecimal(-0.1)).toThrow();
    expect(() => impliedToDecimal(1.1)).toThrow();
  });
});

describe("decimalToAmerican", () => {
  it("odds ≥ 2 → moneyline positivo", () => {
    expect(decimalToAmerican(2.5)).toBe(150);
    expect(decimalToAmerican(3.0)).toBe(200);
  });

  it("odds < 2 → moneyline negativo", () => {
    expect(decimalToAmerican(1.5)).toBe(-200);
    expect(decimalToAmerican(1.25)).toBe(-400);
  });

  it("odds = 2.0 → +100 (even)", () => {
    expect(decimalToAmerican(2.0)).toBe(100);
  });
});

describe("americanToDecimal", () => {
  it("moneyline positivo → decimal", () => {
    expect(americanToDecimal(150)).toBeCloseTo(2.5, 6);
    expect(americanToDecimal(100)).toBeCloseTo(2.0, 6);
  });

  it("moneyline negativo → decimal", () => {
    expect(americanToDecimal(-200)).toBeCloseTo(1.5, 6);
    expect(americanToDecimal(-400)).toBeCloseTo(1.25, 6);
  });

  it("ida e volta: decimal → american → decimal", () => {
    for (const odds of [1.2, 1.5, 2.0, 3.0, 5.0, 10.0]) {
      const american = decimalToAmerican(odds);
      expect(americanToDecimal(american)).toBeCloseTo(odds, 1);
    }
  });
});

describe("decimalToFractional", () => {
  it("converte para fração reduzida", () => {
    expect(decimalToFractional(2.5)).toBe("3/2");
    expect(decimalToFractional(3.0)).toBe("2/1");
    expect(decimalToFractional(1.5)).toBe("1/2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Verificação: funções de cálculo quantitativo NÃO devem estar exportadas
// ═══════════════════════════════════════════════════════════════════════════

describe("funções removidas não exportadas", () => {
  it("módulo odds.ts não exporta funções de vig removal", async () => {
    const oddsModule = await import("./odds");
    const exportedNames = Object.keys(oddsModule);

    // Funções de cálculo quantitativo devem ter sido removidas
    const forbiddenExports = [
      "calculateOverround",
      "removVig",
      "removeVigMultiplicative",
      "removeVigPower",
      "removeVigShin",
      "removeVig",
      "fairProbabilities",
      "fairOdds",
      "VigRemovalMethod",
    ];

    for (const name of forbiddenExports) {
      expect(exportedNames, `${name} não deveria estar exportado`).not.toContain(name);
    }
  });

  it("módulo odds.ts exporta apenas funções de conversão de formato", async () => {
    const oddsModule = await import("./odds");
    const exportedNames = Object.keys(oddsModule);

    const allowedExports = [
      "decimalToImplied",
      "impliedToDecimal",
      "decimalToAmerican",
      "americanToDecimal",
      "decimalToFractional",
    ];

    for (const name of allowedExports) {
      expect(exportedNames, `${name} deveria estar exportado`).toContain(name);
    }
  });
});
