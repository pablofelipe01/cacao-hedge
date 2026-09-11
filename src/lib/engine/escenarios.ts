/**
 * Matriz determinística de escenarios.
 *
 * Tres ejes que se mueven de forma independiente:
 *   - precio del futuro CC: −30 % a +30 %
 *   - TRM:                  −10 % a +10 %
 *   - base (diferencial):   −100, 0, +100 USD/TM
 *
 * Que la base tenga su propio eje no es un detalle: es la manera de
 * mostrar que la cobertura con futuros deja vivo el riesgo de base. Un
 * exportador perfectamente cubierto en NY todavía pierde si el
 * diferencial del fino de aroma se desploma.
 */

import type { Escenario, Mercado } from "./tipos";

/** Desviaciones relativas del precio del futuro. */
export const EJE_PRECIO = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] as const;

/** Desviaciones relativas de la TRM. */
export const EJE_TRM = [-0.1, 0, 0.1] as const;

/** Desviaciones absolutas de la base, en USD/TM. */
export const EJE_BASE = [-100, 0, 100] as const;

function formatearPorcentaje(x: number): string {
  const signo = x > 0 ? "+" : "";
  return `${signo}${Math.round(x * 100)} %`;
}

function formatearAbsoluto(x: number): string {
  const signo = x > 0 ? "+" : "";
  return `${signo}${x}`;
}

/**
 * Construye la matriz completa: 7 × 3 × 3 = 63 escenarios.
 *
 * @param diferencialBase Base esperada del lote, USD/TM, o una función
 *                        del futuro del escenario cuando el diferencial
 *                        se pactó como porcentaje. Los escenarios la
 *                        desplazan en ±100 alrededor de ese valor.
 *
 * El desplazamiento sigue siendo absoluto incluso en modo porcentual, y
 * es una buena aproximación: para un descuento que oscila entre el 22 % y
 * el 25 %, ±100 USD/TM sobre un futuro de 6.000 son ±1,7 puntos
 * porcentuales, que cubre ese rango.
 */
export function construirMatrizEscenarios(
  mercado: Pick<Mercado, "futuroUsdTm" | "trm">,
  diferencialBase: number | ((futuroUsdTm: number) => number),
): Escenario[] {
  const baseDe = (futuro: number) =>
    typeof diferencialBase === "function" ? diferencialBase(futuro) : diferencialBase;

  const escenarios: Escenario[] = [];

  for (const dPrecio of EJE_PRECIO) {
    for (const dTrm of EJE_TRM) {
      for (const dBase of EJE_BASE) {
        const futuro = mercado.futuroUsdTm * (1 + dPrecio);
        escenarios.push({
          futuroUsdTm: futuro,
          trm: mercado.trm * (1 + dTrm),
          diferencialUsdTm: baseDe(futuro) + dBase,
          etiqueta: `futuro ${formatearPorcentaje(dPrecio)} · TRM ${formatearPorcentaje(dTrm)} · base ${formatearAbsoluto(dBase)}`,
          ejes: { precio: dPrecio, trm: dTrm, base: dBase },
        });
      }
    }
  }

  return escenarios;
}

/** El escenario en que nada se mueve: referencia de comparación. */
export function escenarioBase(
  mercado: Pick<Mercado, "futuroUsdTm" | "trm">,
  diferencialBase: number | ((futuroUsdTm: number) => number),
): Escenario {
  return {
    futuroUsdTm: mercado.futuroUsdTm,
    trm: mercado.trm,
    diferencialUsdTm:
      typeof diferencialBase === "function"
        ? diferencialBase(mercado.futuroUsdTm)
        : diferencialBase,
    etiqueta: "sin cambios",
    ejes: { precio: 0, trm: 0, base: 0 },
  };
}

/** Localiza el escenario sin cambios dentro de una matriz. */
export function encontrarCasoBase(escenarios: readonly Escenario[]): Escenario {
  const encontrado = escenarios.find(
    (e) => e.ejes.precio === 0 && e.ejes.trm === 0 && e.ejes.base === 0,
  );
  if (!encontrado) {
    throw new Error("La matriz de escenarios no contiene el caso sin cambios.");
  }
  return encontrado;
}
