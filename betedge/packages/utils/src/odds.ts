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

/**
 * Calcula o overround (a "margem da casa") de um mercado a partir das odds
 * decimais de todos os seus resultados. Overround de 0 = mercado justo (sem
 * margem); valores positivos representam a vantagem embutida da casa.
 *
 * Ex.: mercado 1x2 com odds [2.10, 3.40, 3.60] → overround ≈ 0.057 (5,7%).
 */
export function calculateOverround(decimalOddsList: number[]): number {
  if (decimalOddsList.length === 0) {
    throw new Error("A lista de odds não pode estar vazia");
  }
  const impliedSum = decimalOddsList.reduce(
    (sum, odds) => sum + decimalToImplied(odds),
    0,
  );
  return impliedSum - 1;
}

/**
 * Remove o vig (margem da casa) de uma lista de odds decimais usando o método
 * multiplicativo: cada probabilidade implícita é normalizada dividindo pela
 * soma total das probabilidades implícitas, de forma que a soma resultante
 * seja exatamente 1. Retorna as odds "justas" (fair odds) resultantes.
 *
 * Este é o método mais simples de remoção de vig; não corrige o viés de
 * favorito/azarão que métodos mais sofisticados (Shin, potência) tratam.
 */
export function removVig(decimalOddsList: number[]): number[] {
  if (decimalOddsList.length === 0) {
    throw new Error("A lista de odds não pode estar vazia");
  }
  const impliedProbabilities = decimalOddsList.map(decimalToImplied);
  const totalImplied = impliedProbabilities.reduce((sum, p) => sum + p, 0);

  return impliedProbabilities.map((p) => impliedToDecimal(p / totalImplied));
}
