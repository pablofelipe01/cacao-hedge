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
 * @param diferencialBase Base esperada del lote, USD/TM. Los escenarios
 *                        la desplazan en ±100 alrededor de ese valor.
 */
export function construirMatrizEscenarios(
  mercado: Pick<Mercado, "futuroUsdTm" | "trm">,
  diferencialBase: number,
): Escenario[] {
  const escenarios: Escenario[] = [];

  for (const dPrecio of EJE_PRECIO) {
    for (const dTrm of EJE_TRM) {
      for (const dBase of EJE_BASE) {
        escenarios.push({
          futuroUsdTm: mercado.futuroUsdTm * (1 + dPrecio),
          trm: mercado.trm * (1 + dTrm),
          diferencialUsdTm: diferencialBase + dBase,
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
  diferencialBase: number,
): Escenario {
  return {
    futuroUsdTm: mercado.futuroUsdTm,
    trm: mercado.trm,
    diferencialUsdTm: diferencialBase,
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
