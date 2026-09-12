/**
 * Simulación de Monte Carlo de la utilidad en COP.
 *
 * La matriz determinística responde "¿qué pasa si...?" en 63 puntos
 * elegidos a mano. El Monte Carlo responde otra pregunta, que es la que
 * de verdad importa para decidir: ¿con qué probabilidad este lote
 * termina perdiendo plata, y cuánto en el peor 5 % de los casos?
 *
 * Modelo: movimiento browniano geométrico para el futuro CC y la TRM,
 * correlacionados, más un choque normal independiente sobre la base.
 *
 * Se usan variables antitéticas: cada trayectoria se simula junto con su
 * reflejo (−Z). Eso fuerza a que la media muestral de los choques sea
 * exactamente cero y recorta el error de muestreo. Sin esa corrección,
 * comparar dos estrategias por su utilidad media daba diferencias de
 * varios millones de pesos que eran puro ruido del simulador, no un
 * efecto económico.
 *
 * Deriva cero para el futuro: bajo la medida neutral al riesgo un futuro
 * es una martingala, así que su mejor predictor es el precio de hoy.
 * Meterle una tendencia sería incorporar una opinión de mercado, no un
 * hecho, y este motor no opina sobre la dirección del precio.
 */

import { diferencialEnEscenarioUsdTm } from "./fx";
import { crearPrng, media, parNormalEstandar, percentil } from "./numerico";
import { evaluarEnEscenario } from "./estrategias";
import { diasAAnios } from "./volatilidad";
import type { Escenario, Estrategia, Lote, Mercado, Supuestos } from "./tipos";

/**
 * Desviación típica del choque de base al horizonte, USD/TM.
 *
 * Ya no es un supuesto suelto: sale de `supuestos.desviacionBaseFraccion`
 * escalada al futuro de referencia, y esa fracción está medida contra el
 * precio que publican Nacional de Chocolates y Casa Luker.
 *
 * Se conserva el valor antiguo como respaldo para cuando no hay futuro
 * con el que escalar, pero no debería usarse en un análisis real: son
 * 50 USD/TM, cuatro veces menos que lo observado.
 */
export const DESVIACION_BASE_POR_DEFECTO = 50;

/** Desviación de la base en USD/TM a partir de los supuestos y el futuro. */
export function desviacionBaseUsdTm(
  supuestos: Pick<Supuestos, "desviacionBaseFraccion">,
  futuroUsdTm: number,
): number {
  const s = supuestos.desviacionBaseFraccion * futuroUsdTm;
  return Number.isFinite(s) && s > 0 ? s : DESVIACION_BASE_POR_DEFECTO;
}

export interface OpcionesMonteCarlo {
  trayectorias: number;
  semilla: number;
  correlacionPrecioTrm: number;
  desviacionBaseUsdTm: number;
}

export interface DistribucionMonteCarlo {
  trayectorias: number;
  mediaCop: number;
  medianaCop: number;
  desviacionCop: number;
  minimoCop: number;
  maximoCop: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  /** Probabilidad de que la utilidad sea negativa. */
  probabilidadPerdida: number;
  /** Pérdida respecto a la media en el percentil (1 − confianza). */
  varMonteCarloCop: number;
  /** Pérdida media condicionada a estar en la cola mala (expected shortfall). */
  cvarCop: number;
  /** Histograma listo para graficar. */
  histograma: { desde: number; hasta: number; centro: number; cuenta: number }[];
}

/**
 * Construye las opciones a partir de los supuestos del usuario.
 *
 * El futuro hace falta para escalar la base: sin él se cae al respaldo,
 * que subestima el riesgo y por eso solo debería verse en pruebas.
 */
export function opcionesDesdeSupuestos(
  supuestos: Supuestos,
  futuroUsdTm?: number,
): OpcionesMonteCarlo {
  return {
    trayectorias: supuestos.trayectoriasMc,
    semilla: supuestos.semillaMc,
    correlacionPrecioTrm: supuestos.correlacionPrecioTrm,
    desviacionBaseUsdTm:
      futuroUsdTm != null
        ? desviacionBaseUsdTm(supuestos, futuroUsdTm)
        : DESVIACION_BASE_POR_DEFECTO,
  };
}

/** Agrupa una muestra ordenada en `bins` intervalos de igual ancho. */
export function construirHistograma(
  valoresOrdenados: readonly number[],
  bins = 40,
): DistribucionMonteCarlo["histograma"] {
  const n = valoresOrdenados.length;
  if (n === 0) return [];

  const minimo = valoresOrdenados[0];
  const maximo = valoresOrdenados[n - 1];

  // Muestra degenerada: un único intervalo con todo dentro.
  if (maximo === minimo) {
    return [{ desde: minimo, hasta: maximo, centro: minimo, cuenta: n }];
  }

  const ancho = (maximo - minimo) / bins;
  const cuentas = new Array<number>(bins).fill(0);

  for (const valor of valoresOrdenados) {
    const indice = Math.min(Math.floor((valor - minimo) / ancho), bins - 1);
    cuentas[indice]++;
  }

  return cuentas.map((cuenta, i) => {
    const desde = minimo + i * ancho;
    const hasta = desde + ancho;
    return { desde, hasta, centro: (desde + hasta) / 2, cuenta };
  });
}

/**
 * Simula la distribución de la utilidad en COP de una estrategia.
 *
 * Cada trayectoria se valora con `evaluarEnEscenario`, la misma función
 * que alimenta la matriz determinística. No es una preferencia de estilo:
 * cuando este módulo duplicaba esa cuenta, añadir el caso de cobertura
 * larga actualizó la matriz y dejó atrás el Monte Carlo, que siguió
 * aplicando en silencio las fórmulas del caso contrario. Compartir la
 * función hace imposible esa divergencia.
 */
export function simularMonteCarlo(
  estrategia: Estrategia,
  lote: Lote,
  mercado: Mercado,
  supuestos: Supuestos,
  opciones: OpcionesMonteCarlo = opcionesDesdeSupuestos(supuestos, mercado.futuroUsdTm),
): DistribucionMonteCarlo {
  const { trayectorias, semilla, correlacionPrecioTrm, desviacionBaseUsdTm } = opciones;

  if (trayectorias < 1) {
    throw new Error("Se requiere al menos una trayectoria.");
  }

  const anios = diasAAnios(lote.diasAEmbarque);
  const raizT = Math.sqrt(anios);

  const sigmaPrecio = mercado.volAnualizada * raizT;
  const sigmaTrm = mercado.volTrmAnualizada * raizT;

  // Deriva de la lognormal: −σ²/2 deja la media del precio en F0.
  const derivaPrecio = -0.5 * sigmaPrecio ** 2;
  const derivaTrm = -0.5 * sigmaTrm ** 2;

  // Descomposición de Cholesky en dos dimensiones.
  const rho = Math.max(-1, Math.min(1, correlacionPrecioTrm));
  const complemento = Math.sqrt(1 - rho ** 2);

  const prng = crearPrng(semilla);
  const utilidades = new Array<number>(trayectorias);

  /** Evalúa una trayectoria a partir de sus tres choques normales. */
  const evaluar = (z1: number, z2: number, z3: number): number => {
    const zTrm = rho * z1 + complemento * z2;
    const futuro = mercado.futuroUsdTm * Math.exp(derivaPrecio + sigmaPrecio * z1);

    const escenario: Escenario = {
      futuroUsdTm: futuro,
      trm: mercado.trm * Math.exp(derivaTrm + sigmaTrm * zTrm),
      // El diferencial se recalcula contra el futuro de ESTA trayectoria:
      // si se pactó como porcentaje, se mueve con la bolsa.
      diferencialUsdTm:
        diferencialEnEscenarioUsdTm(lote, futuro) + desviacionBaseUsdTm * z3,
      etiqueta: "mc",
      ejes: { precio: 0, trm: 0, base: 0 },
    };

    return evaluarEnEscenario(estrategia, lote, mercado, escenario, supuestos).utilidadCop;
  };

  for (let i = 0; i < trayectorias; i += 2) {
    const [z1, z2] = parNormalEstandar(prng);
    // Tercer choque independiente para la base: su riesgo es propio y no
    // se elimina cubriéndose en NY.
    const [z3] = parNormalEstandar(prng);

    utilidades[i] = evaluar(z1, z2, z3);
    // Trayectoria antitética: el reflejo exacto de la anterior.
    if (i + 1 < trayectorias) {
      utilidades[i + 1] = evaluar(-z1, -z2, -z3);
    }
  }

  const ordenadas = [...utilidades].sort((a, b) => a - b);
  const promedio = media(ordenadas);

  const alfa = 1 - supuestos.nivelConfianzaVar;
  const cuantilCola = percentil(ordenadas, alfa);

  // Expected shortfall: media de la cola por debajo del cuantil.
  const corte = Math.max(1, Math.floor(alfa * ordenadas.length));
  const cola = ordenadas.slice(0, corte);
  const mediaCola = media(cola);

  let perdidas = 0;
  for (const u of ordenadas) {
    if (u < 0) perdidas++;
    else break; // están ordenadas: en cuanto una no es negativa, ninguna lo es
  }

  let sumaCuadrados = 0;
  for (const u of ordenadas) sumaCuadrados += (u - promedio) ** 2;
  const desviacion =
    ordenadas.length > 1 ? Math.sqrt(sumaCuadrados / (ordenadas.length - 1)) : 0;

  return {
    trayectorias,
    mediaCop: promedio,
    medianaCop: percentil(ordenadas, 0.5),
    desviacionCop: desviacion,
    minimoCop: ordenadas[0],
    maximoCop: ordenadas[ordenadas.length - 1],
    percentiles: {
      p5: percentil(ordenadas, 0.05),
      p25: percentil(ordenadas, 0.25),
      p50: percentil(ordenadas, 0.5),
      p75: percentil(ordenadas, 0.75),
      p95: percentil(ordenadas, 0.95),
    },
    probabilidadPerdida: perdidas / ordenadas.length,
    varMonteCarloCop: promedio - cuantilCola,
    cvarCop: promedio - mediaCola,
    histograma: construirHistograma(ordenadas),
  };
}
