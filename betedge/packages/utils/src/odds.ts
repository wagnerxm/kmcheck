/**
 * Conversões e cálculos de odds. Toda a plataforma trabalha internamente com
 * odds decimais (formato europeu) — as demais notações (americana, fracionária)
 * existem apenas para exibição, já que muitos usuários brasileiros conhecem o
 * formato americano vindo de casas internacionais.
 */

/** Converte odds decimais em probabilidade implícita (0–1). Ex.: 2.00 → 0.50. */
export function decimalToImplied(decimalOdds: number): number {
  if (decimalOdds <= 1) {
    throw new Error("Odds decimais devem ser maiores que 1.0");
  }
  return 1 / decimalOdds;
}

/** Converte probabilidade implícita (0–1) em odds decimais. Ex.: 0.50 → 2.00. */
export function impliedToDecimal(probability: number): number {
  if (probability <= 0 || probability > 1) {
    throw new Error("Probabilidade deve estar no intervalo (0, 1]");
  }
  return 1 / probability;
}

/**
 * Converte odds decimais em odds americanas (moneyline).
 * Ex.: 2.50 → +150 ; 1.50 → -200.
 */
export function decimalToAmerican(decimalOdds: number): number {
  if (decimalOdds <= 1) {
    throw new Error("Odds decimais devem ser maiores que 1.0");
  }
  if (decimalOdds >= 2) {
    return Math.round((decimalOdds - 1) * 100);
  }
  return Math.round(-100 / (decimalOdds - 1));
}

/**
 * Converte odds americanas (moneyline) em odds decimais.
 * Ex.: +150 → 2.50 ; -200 → 1.50.
 */
export function americanToDecimal(americanOdds: number): number {
  if (americanOdds === 0) {
    throw new Error("Odds americanas não podem ser zero");
  }
  if (americanOdds > 0) {
    return americanOdds / 100 + 1;
  }
  return 100 / Math.abs(americanOdds) + 1;
}

/**
 * Converte odds decimais em odds fracionárias (formato britânico), ex.: 2.50 → "3/2".
 * A fração é reduzida ao menor termo usando o MDC.
 */
export function decimalToFractional(decimalOdds: number): string {
  if (decimalOdds <= 1) {
    throw new Error("Odds decimais devem ser maiores que 1.0");
  }
  const decimalPart = decimalOdds - 1;
  // Precisão de 2 casas decimais evita denominadores absurdamente grandes.
  const precision = 100;
  let numerator = Math.round(decimalPart * precision);
  let denominator = precision;

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(numerator, denominator) || 1;

  numerator = numerator / divisor;
  denominator = denominator / divisor;

  return `${numerator}/${denominator}`;
}

// ============================================================================
// NOTA: Cálculos quantitativos (Shin, power, multiplicative, overround,
// fair probability, Edge, EV, Kelly, CLV) foram REMOVIDOS deste módulo.
// Python é a única fonte oficial de toda matemática quantitativa do PREDIQ.
// TypeScript consome valores canônicos via API/banco de dados.
//
// Funções removidas (2026-08-29):
//   calculateOverround, removVig, removeVigMultiplicative, removeVigPower,
//   removeVigShin, removeVig, fairProbabilities, fairOdds, VigRemovalMethod
//
// Ver: PYTHON_TS_CONVERGENCE_REPORT.md
// ============================================================================
