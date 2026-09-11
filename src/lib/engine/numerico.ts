/**
 * Utilidades numéricas: distribución normal, estadística descriptiva y
 * generación pseudoaleatoria sembrada.
 *
 * Todo aquí es determinista. El PRNG recibe semilla explícita para que
 * un Monte Carlo se pueda reproducir exactamente.
 */

/** Densidad de la normal estándar. */
export function densidadNormal(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Función de distribución acumulada de la normal estándar.
 *
 * Aproximación de Abramowitz & Stegun 26.2.17: error absoluto < 7,5e-8,
 * de sobra para valoración de opciones y VaR.
 */
export function normalAcumulada(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;

  const signo = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;

  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);

  return 0.5 * (1 + signo * y);
}

/**
 * Inversa de la normal acumulada (función cuantil).
 *
 * Algoritmo de Acklam; error relativo < 1,15e-9. Se usa para obtener el
 * factor z del VaR a partir del nivel de confianza.
 */
export function normalInversa(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error(`normalInversa espera p en (0,1), recibió ${p}`);
  }

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pBajo = 0.02425;
  const pAlto = 1 - pBajo;

  let q: number;

  if (p < pBajo) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  if (p > pAlto) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }

  q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Factor z del VaR: z(0.95) ≈ 1,645. */
export function factorZ(nivelConfianza: number): number {
  return normalInversa(nivelConfianza);
}

// ---------------------------------------------------------------------
// Generación pseudoaleatoria sembrada
// ---------------------------------------------------------------------

/**
 * PRNG mulberry32: rápido, sin dependencias y reproducible a partir de
 * una semilla entera. Suficiente para Monte Carlo de escenarios; no es
 * criptográficamente seguro y no pretende serlo.
 */
export function crearPrng(semilla: number): () => number {
  let estado = semilla >>> 0;
  return function siguiente(): number {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Genera pares de normales estándar independientes por Box-Muller.
 *
 * Devuelve dos valores por llamada porque el método los produce en
 * pareja; desperdiciar uno duplicaría el costo.
 */
export function parNormalEstandar(prng: () => number): [number, number] {
  // Evita log(0): mulberry32 puede devolver exactamente 0.
  const u1 = Math.max(prng(), Number.EPSILON);
  const u2 = prng();
  const radio = Math.sqrt(-2 * Math.log(u1));
  const angulo = 2 * Math.PI * u2;
  return [radio * Math.cos(angulo), radio * Math.sin(angulo)];
}

// ---------------------------------------------------------------------
// Estadística descriptiva
// ---------------------------------------------------------------------

export function media(valores: readonly number[]): number {
  if (valores.length === 0) return Number.NaN;
  let suma = 0;
  for (const v of valores) suma += v;
  return suma / valores.length;
}

/** Desviación estándar muestral (divide por n-1). */
export function desviacionEstandar(valores: readonly number[]): number {
  const n = valores.length;
  if (n < 2) return Number.NaN;
  const m = media(valores);
  let acumulado = 0;
  for (const v of valores) acumulado += (v - m) ** 2;
  return Math.sqrt(acumulado / (n - 1));
}

/**
 * Percentil por interpolación lineal sobre la muestra ordenada.
 * `p` va de 0 a 1.
 */
export function percentil(valoresOrdenados: readonly number[], p: number): number {
  const n = valoresOrdenados.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return valoresOrdenados[0];

  const posicion = p * (n - 1);
  const inferior = Math.floor(posicion);
  const superior = Math.ceil(posicion);
  if (inferior === superior) return valoresOrdenados[inferior];

  const peso = posicion - inferior;
  return valoresOrdenados[inferior] * (1 - peso) + valoresOrdenados[superior] * peso;
}

/** Redondeo a `decimales` cifras, evitando ruido de punto flotante. */
export function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * factor) / factor;
}
