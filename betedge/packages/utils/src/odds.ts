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

// ============================================================================
// Remoção de vig — métodos avançados
//
// Cada método produz probabilidades "justas" (sem margem) a partir das odds
// decimais. A soma das probabilidades resultantes é sempre ≈ 1.0.
// ============================================================================

/** Tipo dos métodos de remoção de vig suportados. */
export type VigRemovalMethod = "multiplicative" | "power" | "shin";

/**
 * Remove o vig via normalização multiplicativa — distribui a margem
 * proporcionalmente entre todos os resultados.
 *
 *     p_i = pi_i / sum(pi_j)
 *
 * @param impliedProbs — probabilidades implícitas (com vig) de todos os
 *   resultados de um mercado (ex.: [P(casa), P(empate), P(fora)]).
 * @returns Probabilidades "justas" que somam 1.
 */
export function removeVigMultiplicative(impliedProbs: number[]): number[] {
  if (impliedProbs.length === 0) {
    throw new Error("A lista de probabilidades não pode estar vazia");
  }
  const total = impliedProbs.reduce((s, p) => s + p, 0);
  if (total <= 0) {
    throw new Error("A soma das probabilidades implícitas deve ser positiva");
  }
  return impliedProbs.map((p) => p / total);
}

/**
 * Remove o vig pelo método da potência (power method) — assume que a relação
 * entre a probabilidade implícita e a verdadeira segue uma lei de potência:
 *
 *     pi_i = p_i^(1/k)
 *
 * Resolve numericamente o expoente `k` tal que `sum(pi_i^k) = 1`, por busca
 * binária. Corrige melhor o viés favorito/azarão do que a normalização
 * multiplicativa simples.
 *
 * @param impliedProbs — probabilidades implícitas em (0, 1) estrito.
 * @returns Probabilidades "justas" que somam 1.
 */
export function removeVigPower(
  impliedProbs: number[],
  tol = 1e-10,
  maxIter = 200,
): number[] {
  if (impliedProbs.length === 0) {
    throw new Error("A lista de probabilidades não pode estar vazia");
  }
  if (impliedProbs.some((p) => p <= 0 || p >= 1)) {
    throw new Error("power method requer 0 < pi_i < 1 para todo resultado");
  }

  const totalAt = (k: number) =>
    impliedProbs.reduce((s, p) => s + Math.pow(p, k), 0);

  // Se já não há overround perceptível, normalização multiplicativa basta
  if (Math.abs(totalAt(1.0) - 1.0) < tol) {
    return removeVigMultiplicative(impliedProbs);
  }

  let lo = 1.0;
  let hi = 2.0;

  // Expandir hi até a soma cair abaixo de 1
  while (totalAt(hi) > 1.0) {
    hi *= 2.0;
    if (hi > 1e6) {
      throw new Error("power method não convergiu");
    }
  }

  // Busca binária pelo k*
  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2.0;
    if (totalAt(mid) > 1.0) {
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < tol) break;
  }

  const k = (lo + hi) / 2.0;
  const probs = impliedProbs.map((p) => Math.pow(p, k));

  // Normalização final p/ corrigir erro residual de ponto flutuante
  const s = probs.reduce((sum, p) => sum + p, 0);
  return probs.map((p) => p / s);
}

/**
 * Remove o vig pelo método de Shin (1992/1993) — modela a margem como
 * resultante de uma fração `z` de apostadores informados (insider trading).
 *
 *     p_i(z) = [ sqrt(z² + 4(1-z)·pi_i²/S) - z ] / (2(1-z))
 *
 * onde S = sum(pi_j). Resolve z por busca binária tal que sum(p_i) = 1.
 * Tende a atribuir mais probabilidade a azarões do que a multiplicativa,
 * refletindo que o overround não é uniforme entre os resultados.
 *
 * @param impliedProbs — probabilidades implícitas (com vig), > 0.
 * @returns Probabilidades "justas" que somam 1.
 */
export function removeVigShin(
  impliedProbs: number[],
  tol = 1e-12,
  maxIter = 200,
): number[] {
  if (impliedProbs.length === 0) {
    throw new Error("A lista de probabilidades não pode estar vazia");
  }
  if (impliedProbs.some((p) => p <= 0)) {
    throw new Error("shin method requer pi_i > 0 para todo resultado");
  }

  const s = impliedProbs.reduce((sum, p) => sum + p, 0);

  const probsAt = (z: number): number[] => {
    if (z <= 0) {
      // No limite z->0 a fórmula se reduz a pi_i / sqrt(S)
      const sqrtS = Math.sqrt(s);
      return impliedProbs.map((p) => p / sqrtS);
    }
    const denom = 2.0 * (1.0 - z);
    return impliedProbs.map(
      (p) =>
        (Math.sqrt(z * z + (4.0 * (1.0 - z) * p * p) / s) - z) / denom,
    );
  };

  const totalAt = (z: number): number =>
    probsAt(z).reduce((sum, p) => sum + p, 0);

  // Sem overround (ou "book plus"): normalização multiplicativa basta
  if (s <= 1.0) {
    return removeVigMultiplicative(impliedProbs);
  }

  let lo = 0.0;
  let hi = 1.0 - 1e-9;

  let zStar: number;
  if (totalAt(hi) > 1.0) {
    // Overround extremo — melhor esforço
    zStar = hi;
  } else {
    for (let i = 0; i < maxIter; i++) {
      const mid = (lo + hi) / 2.0;
      if (totalAt(mid) > 1.0) {
        lo = mid;
      } else {
        hi = mid;
      }
      if (hi - lo < tol) break;
    }
    zStar = (lo + hi) / 2.0;
  }

  const probs = probsAt(zStar);
  const total = probs.reduce((sum, p) => sum + p, 0);
  return probs.map((p) => p / total);
}

/**
 * Interface unificada: remove o vig das probabilidades implícitas usando
 * o método especificado.
 *
 * @param impliedProbs — probabilidades implícitas (com vig), tipicamente
 *   obtidas de odds decimais via `decimalToImplied()`.
 * @param method — método de remoção de vig (padrão: "multiplicative").
 * @returns Probabilidades "justas" que somam 1.
 */
export function removeVig(
  impliedProbs: number[],
  method: VigRemovalMethod = "multiplicative",
): number[] {
  switch (method) {
    case "multiplicative":
      return removeVigMultiplicative(impliedProbs);
    case "power":
      return removeVigPower(impliedProbs);
    case "shin":
      return removeVigShin(impliedProbs);
    default:
      throw new Error(`Método de remoção de vig desconhecido: ${method}`);
  }
}

/**
 * Calcula as probabilidades "justas" (sem vig/margem) a partir de odds decimais,
 * usando o método especificado.
 *
 * Atalho para: converter odds → prob. implícitas, remover vig, retornar.
 *
 * @param decimalOddsList — odds decimais de todos os resultados de um mercado.
 * @param method — método de remoção de vig (padrão: "multiplicative").
 * @returns Probabilidades "justas" que somam 1, na mesma ordem das odds de entrada.
 */
export function fairProbabilities(
  decimalOddsList: number[],
  method: VigRemovalMethod = "multiplicative",
): number[] {
  const implied = decimalOddsList.map(decimalToImplied);
  return removeVig(implied, method);
}

/**
 * Calcula as odds "justas" (sem margem) a partir de odds decimais de mercado.
 *
 * @param decimalOddsList — odds decimais de todos os resultados de um mercado.
 * @param method — método de remoção de vig (padrão: "multiplicative").
 * @returns Odds decimais "justas" (fair odds), na mesma ordem da entrada.
 */
export function fairOdds(
  decimalOddsList: number[],
  method: VigRemovalMethod = "multiplicative",
): number[] {
  const fairProbs = fairProbabilities(decimalOddsList, method);
  return fairProbs.map(impliedToDecimal);
}
