/**
 * Testes unitários das funções de odds e remoção de vig.
 *
 * Cobertura: conversões de odds, overround, remoção de vig (3 métodos),
 * fairProbabilities, fairOdds, interface unificada removeVig.
 */

import { describe, expect, it } from "vitest";
import {
  decimalToImplied,
  impliedToDecimal,
  decimalToAmerican,
  americanToDecimal,
  decimalToFractional,
  calculateOverround,
  removVig,
  removeVigMultiplicative,
  removeVigPower,
  removeVigShin,
  removeVig,
  fairProbabilities,
  fairOdds,
} from "./odds";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Verifica que os valores somam ≈ 1.0. */
function expectSumsToOne(probs: number[], tol = 1e-6) {
  const sum = probs.reduce((s, p) => s + p, 0);
  expect(sum).toBeCloseTo(1.0, 6);
}

/** Verifica que cada probabilidade está em (0, 1). */
function expectAllInRange(probs: number[]) {
  for (const p of probs) {
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversões básicas
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
// Overround
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateOverround", () => {
  it("calcula a margem de um mercado 1x2 típico", () => {
    // Odds: 2.10, 3.40, 3.60 → pi ≈ 0.4762 + 0.2941 + 0.2778 = 1.0481
    const or = calculateOverround([2.1, 3.4, 3.6]);
    expect(or).toBeCloseTo(0.0481, 3);
  });

  it("mercado justo (sem margem) → overround ≈ 0", () => {
    // Odds: 2.0, 2.0 para mercado binário justo
    const or = calculateOverround([2.0, 2.0]);
    expect(or).toBeCloseTo(0, 6);
  });

  it("lança erro para lista vazia", () => {
    expect(() => calculateOverround([])).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// removVig (legado — retorna odds justas)
// ═══════════════════════════════════════════════════════════════════════════

describe("removVig (legado)", () => {
  it("retorna odds justas (decimais) sem margem", () => {
    const fairOddsList = removVig([2.1, 3.4, 3.6]);
    // A soma das probabilidades implícitas das fair odds deve ser ≈ 1
    const impliedSum = fairOddsList.reduce((s, o) => s + 1 / o, 0);
    expect(impliedSum).toBeCloseTo(1.0, 6);
  });

  it("mercado justo permanece inalterado", () => {
    const fairOddsList = removVig([2.0, 2.0]);
    expect(fairOddsList[0]).toBeCloseTo(2.0, 4);
    expect(fairOddsList[1]).toBeCloseTo(2.0, 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// removeVigMultiplicative
// ═══════════════════════════════════════════════════════════════════════════

describe("removeVigMultiplicative", () => {
  it("normaliza probabilidades implícitas para somar 1", () => {
    // Mercado 1x2: odds 2.10, 3.40, 3.60
    const implied = [1 / 2.1, 1 / 3.4, 1 / 3.6]; // soma ≈ 1.048
    const fair = removeVigMultiplicative(implied);

    expectSumsToOne(fair);
    expectAllInRange(fair);
  });

  it("mantém a ordem relativa das probabilidades", () => {
    const implied = [0.5, 0.3, 0.25]; // soma = 1.05
    const fair = removeVigMultiplicative(implied);

    expect(fair[0]).toBeGreaterThan(fair[1]);
    expect(fair[1]).toBeGreaterThan(fair[2]);
  });

  it("preserva proporcionalidade exata", () => {
    const implied = [0.6, 0.3, 0.2]; // soma = 1.1
    const fair = removeVigMultiplicative(implied);

    // Razão entre fair probs deve ser igual à razão entre implied probs
    expect(fair[0] / fair[1]).toBeCloseTo(0.6 / 0.3, 6);
    expect(fair[1] / fair[2]).toBeCloseTo(0.3 / 0.2, 6);
  });

  it("probabilidades sem vig retornam inalteradas", () => {
    const implied = [0.5, 0.3, 0.2]; // soma = 1.0
    const fair = removeVigMultiplicative(implied);

    expect(fair[0]).toBeCloseTo(0.5, 6);
    expect(fair[1]).toBeCloseTo(0.3, 6);
    expect(fair[2]).toBeCloseTo(0.2, 6);
  });

  it("lança erro para lista vazia", () => {
    expect(() => removeVigMultiplicative([])).toThrow();
  });

  it("lança erro quando soma é zero ou negativa", () => {
    expect(() => removeVigMultiplicative([0, 0, 0])).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// removeVigPower
// ═══════════════════════════════════════════════════════════════════════════

describe("removeVigPower", () => {
  it("produz probabilidades que somam 1", () => {
    const implied = [1 / 2.1, 1 / 3.4, 1 / 3.6];
    const fair = removeVigPower(implied);

    expectSumsToOne(fair);
    expectAllInRange(fair);
  });

  it("mantém a ordem relativa", () => {
    const implied = [1 / 1.8, 1 / 3.5, 1 / 4.0];
    const fair = removeVigPower(implied);

    expect(fair[0]).toBeGreaterThan(fair[1]);
    expect(fair[1]).toBeGreaterThan(fair[2]);
  });

  it("produz resultado diferente do multiplicativo (corrige viés)", () => {
    // Favorito forte vs azarão com overround
    const impliedWithVig = [1 / 1.15, 1 / 6.5]; // [0.8696, 0.1538], soma ≈ 1.023
    const fairMult = removeVigMultiplicative(impliedWithVig);
    const fairPow = removeVigPower(impliedWithVig);

    // O power method deve produzir um resultado que difere do multiplicativo
    // (a direção depende da forma do mercado, mas os valores diferem)
    const diff = Math.abs(fairPow[1] - fairMult[1]);
    expect(diff).toBeGreaterThan(0.001);
    expectSumsToOne(fairPow);
  });

  it("sem overround → retorna multiplicativo", () => {
    const implied = [0.5, 0.3, 0.2]; // soma = 1.0
    const fair = removeVigPower(implied);

    expect(fair[0]).toBeCloseTo(0.5, 4);
    expect(fair[1]).toBeCloseTo(0.3, 4);
    expect(fair[2]).toBeCloseTo(0.2, 4);
  });

  it("overround alto (>20%) ainda converge", () => {
    // Mercado com margem muito alta
    const implied = [0.55, 0.40, 0.35]; // soma = 1.30 → 30% overround
    const fair = removeVigPower(implied);

    expectSumsToOne(fair);
    expectAllInRange(fair);
  });

  it("lança erro para pi_i ≥ 1 ou ≤ 0", () => {
    expect(() => removeVigPower([1.0, 0.5])).toThrow();
    expect(() => removeVigPower([0, 0.5])).toThrow();
  });

  it("lança erro para lista vazia", () => {
    expect(() => removeVigPower([])).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// removeVigShin
// ═══════════════════════════════════════════════════════════════════════════

describe("removeVigShin", () => {
  it("produz probabilidades que somam 1", () => {
    const implied = [1 / 2.1, 1 / 3.4, 1 / 3.6];
    const fair = removeVigShin(implied);

    expectSumsToOne(fair);
    expectAllInRange(fair);
  });

  it("mantém a ordem relativa", () => {
    const implied = [1 / 1.8, 1 / 3.5, 1 / 4.0];
    const fair = removeVigShin(implied);

    expect(fair[0]).toBeGreaterThan(fair[1]);
    expect(fair[1]).toBeGreaterThan(fair[2]);
  });

  it("produz resultado diferente do multiplicativo (modelo Shin)", () => {
    // Favorito forte vs azarão com overround
    const implied = [1 / 1.15, 1 / 6.5]; // [0.8696, 0.1538]
    const fairMult = removeVigMultiplicative(implied);
    const fairShin = removeVigShin(implied);

    // Shin modela insider trading — deve diferir do multiplicativo
    const diff = Math.abs(fairShin[1] - fairMult[1]);
    expect(diff).toBeGreaterThan(0.001);
    expectSumsToOne(fairShin);
  });

  it("sem overround (soma ≤ 1) → retorna multiplicativo", () => {
    const implied = [0.5, 0.3, 0.2]; // soma = 1.0
    const fair = removeVigShin(implied);

    expect(fair[0]).toBeCloseTo(0.5, 4);
    expect(fair[1]).toBeCloseTo(0.3, 4);
    expect(fair[2]).toBeCloseTo(0.2, 4);
  });

  it("overround alto ainda converge", () => {
    const implied = [0.55, 0.40, 0.35]; // soma = 1.30
    const fair = removeVigShin(implied);

    expectSumsToOne(fair);
    expectAllInRange(fair);
  });

  it("mercado binário simétrico", () => {
    // Odds: 1.90, 1.90 → implied: [0.5263, 0.5263], soma ≈ 1.0526
    const implied = [1 / 1.9, 1 / 1.9];
    const fair = removeVigShin(implied);

    // Mercado simétrico → probabilidades justas devem ser iguais
    expect(fair[0]).toBeCloseTo(fair[1], 4);
    expect(fair[0]).toBeCloseTo(0.5, 4);
  });

  it("lança erro para pi_i ≤ 0", () => {
    expect(() => removeVigShin([0, 0.5])).toThrow();
    expect(() => removeVigShin([-0.1, 0.5])).toThrow();
  });

  it("lança erro para lista vazia", () => {
    expect(() => removeVigShin([])).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// removeVig (interface unificada)
// ═══════════════════════════════════════════════════════════════════════════

describe("removeVig (interface unificada)", () => {
  const implied = [1 / 2.1, 1 / 3.4, 1 / 3.6];

  it("default é multiplicativo", () => {
    const fair = removeVig(implied);
    const fairMult = removeVigMultiplicative(implied);

    for (let i = 0; i < fair.length; i++) {
      expect(fair[i]).toBeCloseTo(fairMult[i], 10);
    }
  });

  it("method='multiplicative' despacha corretamente", () => {
    const fair = removeVig(implied, "multiplicative");
    const fairMult = removeVigMultiplicative(implied);

    for (let i = 0; i < fair.length; i++) {
      expect(fair[i]).toBeCloseTo(fairMult[i], 10);
    }
  });

  it("method='power' despacha corretamente", () => {
    const fair = removeVig(implied, "power");
    const fairPow = removeVigPower(implied);

    for (let i = 0; i < fair.length; i++) {
      expect(fair[i]).toBeCloseTo(fairPow[i], 10);
    }
  });

  it("method='shin' despacha corretamente", () => {
    const fair = removeVig(implied, "shin");
    const fairShin = removeVigShin(implied);

    for (let i = 0; i < fair.length; i++) {
      expect(fair[i]).toBeCloseTo(fairShin[i], 10);
    }
  });

  it("lança erro para método desconhecido", () => {
    // @ts-expect-error — testando runtime guard
    expect(() => removeVig(implied, "desconhecido")).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// fairProbabilities & fairOdds
// ═══════════════════════════════════════════════════════════════════════════

describe("fairProbabilities", () => {
  it("converte odds decimais em probabilidades justas", () => {
    const odds = [2.1, 3.4, 3.6];
    const fair = fairProbabilities(odds);

    expectSumsToOne(fair);
    expectAllInRange(fair);
    // Favorito (menor odd = maior prob) deve ter a maior prob justa
    expect(fair[0]).toBeGreaterThan(fair[1]);
    expect(fair[0]).toBeGreaterThan(fair[2]);
  });

  it("aceita método power", () => {
    const odds = [2.1, 3.4, 3.6];
    const fair = fairProbabilities(odds, "power");

    expectSumsToOne(fair);
    expectAllInRange(fair);
  });

  it("aceita método shin", () => {
    const odds = [2.1, 3.4, 3.6];
    const fair = fairProbabilities(odds, "shin");

    expectSumsToOne(fair);
    expectAllInRange(fair);
  });
});

describe("fairOdds", () => {
  it("retorna odds decimais sem margem", () => {
    const odds = [2.1, 3.4, 3.6];
    const fair = fairOdds(odds);

    // Fair odds devem ser ≥ odds originais (sem margem → odds maiores)
    for (let i = 0; i < odds.length; i++) {
      expect(fair[i]).toBeGreaterThanOrEqual(odds[i]);
    }

    // A soma das probabilidades implícitas das fair odds deve ser ≈ 1
    const impliedSum = fair.reduce((s, o) => s + 1 / o, 0);
    expect(impliedSum).toBeCloseTo(1.0, 6);
  });

  it("mercado justo → fair odds ≈ odds originais", () => {
    const odds = [2.0, 2.0]; // mercado sem margem
    const fair = fairOdds(odds);

    expect(fair[0]).toBeCloseTo(2.0, 4);
    expect(fair[1]).toBeCloseTo(2.0, 4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Consistência entre métodos — propriedades que todos devem satisfazer
// ═══════════════════════════════════════════════════════════════════════════

describe("consistência entre métodos", () => {
  const testCases = [
    { name: "1x2 brasileiro típico", odds: [2.1, 3.4, 3.6] },
    { name: "mercado binário (BTTS)", odds: [1.75, 2.0] },
    { name: "grande favorito", odds: [1.15, 6.5] },
    { name: "mercado equilibrado", odds: [1.9, 1.9] },
    { name: "Double chance", odds: [1.35, 1.65, 2.5] },
  ];

  for (const { name, odds } of testCases) {
    describe(name, () => {
      const implied = odds.map((o) => 1 / o);
      const methods = ["multiplicative", "power", "shin"] as const;

      for (const method of methods) {
        it(`${method}: probabilidades somam 1 e estão em (0,1)`, () => {
          const fair = removeVig(implied, method);
          expectSumsToOne(fair);
          expectAllInRange(fair);
        });

        it(`${method}: mantém ordenação das probabilidades`, () => {
          const fair = removeVig(implied, method);
          // O resultado com maior prob implícita deve ter a maior fair prob
          const sortedImplied = [...implied].sort((a, b) => b - a);
          const sortedFair = [...fair].sort((a, b) => b - a);
          for (let i = 0; i < sortedImplied.length; i++) {
            const originalIdx = implied.indexOf(sortedImplied[i]);
            const fairIdx = fair.indexOf(sortedFair[i]);
            expect(originalIdx).toBe(fairIdx);
          }
        });
      }

      it("todos os métodos produzem probabilidades 'maiores' (vig removido)", () => {
        const overround = implied.reduce((s, p) => s + p, 0) - 1;
        if (overround <= 0) return; // sem vig, nada a verificar

        for (const method of methods) {
          const fair = removeVig(implied, method);
          // Fair probs são menores que implied probs (margem removida)
          for (let i = 0; i < implied.length; i++) {
            expect(fair[i]).toBeLessThanOrEqual(implied[i] + 1e-6);
          }
        }
      });
    });
  }
});
