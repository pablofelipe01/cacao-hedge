/**
 * Cobertura cambiaria: forward de venta de dólares.
 *
 * El exportador cobra en dólares y vive en pesos. Cubrir el precio del
 * cacao no toca ese riesgo: medido sobre el caso real, una vez cubierto
 * el precio, cuatro quintas partes del riesgo que queda son la TRM.
 *
 * La cobertura cambiaria es ORTOGONAL a la de precio, no una alternativa.
 * Por eso no entra como una estrategia más en la lista —eso mezclaría dos
 * decisiones— sino como una capa que se monta encima de la que se elija.
 *
 * Instrumento: forward bancario. Es lo que usa un exportador colombiano,
 * se pacta por el monto exacto que haga falta y se liquida contra la TRM.
 * El futuro USD/COP de la BVC existe, pero viene en contratos de 50.000
 * USD y traería el mismo problema de indivisibilidad que el CC.
 */

/**
 * Tasa forward por paridad de tasas de interés.
 *
 * No es un pronóstico de la TRM: es la tasa de hoy llevada al futuro por
 * el diferencial de tasas, y es la única que se puede pactar sin que
 * haya arbitraje. Con tasas colombianas por encima de las
 * estadounidenses, la forward queda POR ENCIMA de la TRM de contado, y
 * eso juega a favor de quien vende dólares a plazo: recibe más pesos por
 * dólar que si vendiera hoy.
 *
 * @param trm       TRM de contado, COP/USD.
 * @param tasaCop   Tasa anual en pesos (efectiva).
 * @param tasaUsd   Tasa anual en dólares (efectiva).
 * @param anios     Plazo en años.
 */
export function tasaForwardCopUsd(
  trm: number,
  tasaCop: number,
  tasaUsd: number,
  anios: number,
): number {
  if (trm <= 0) throw new Error("La TRM debe ser positiva.");
  if (anios < 0) throw new Error("El plazo no puede ser negativo.");
  if (tasaCop <= -1 || tasaUsd <= -1) {
    throw new Error("Las tasas deben ser mayores que −100 %.");
  }

  return (trm * (1 + tasaCop) ** anios) / (1 + tasaUsd) ** anios;
}

/** Puntos forward: cuántos pesos por dólar se ganan sobre la TRM de hoy. */
export function puntosForward(
  trm: number,
  tasaCop: number,
  tasaUsd: number,
  anios: number,
): number {
  return tasaForwardCopUsd(trm, tasaCop, tasaUsd, anios) - trm;
}

/**
 * Resultado en pesos de un forward de VENTA de dólares.
 *
 * Se pactó recibir `tasaForward` por cada dólar; el mercado terminó en
 * `trmFinal`. La diferencia, por el monto cubierto, es lo que aporta o
 * cuesta la cobertura.
 *
 * Positivo cuando el peso se aprecia (la TRM cae), que es exactamente el
 * escenario en que el exportador pierde pesos por el lado del físico.
 */
export function resultadoForwardCop(
  notionalUsd: number,
  tasaForward: number,
  trmFinal: number,
): number {
  return notionalUsd * (tasaForward - trmFinal);
}

/** Ratios de cobertura cambiaria que se comparan. */
export const RATIOS_FX = [0, 0.5, 0.75, 1] as const;

export interface CoberturaFx {
  /** Fracción del flujo neto en dólares que se vende a plazo. */
  ratio: number;
  /** Monto vendido a plazo, USD. */
  notionalUsd: number;
  /** Tasa pactada, COP/USD. */
  tasaForward: number;
  /** Puntos sobre la TRM de contado, COP/USD. */
  puntos: number;
}

/**
 * Construye la capa cambiaria para un flujo neto en dólares.
 *
 * El nocional se calcula sobre el flujo FÍSICO neto —lo que de verdad va
 * a convertir a pesos—, no sobre el valor del lote: en una venta ya
 * cerrada con el costo también en dólares, lo que queda expuesto es el
 * margen, no el ingreso completo.
 */
export function construirCoberturasFx(
  flujoNetoUsd: number,
  trm: number,
  tasaCop: number,
  tasaUsd: number,
  anios: number,
  ratios: readonly number[] = RATIOS_FX,
): CoberturaFx[] {
  const forward = tasaForwardCopUsd(trm, tasaCop, tasaUsd, anios);

  return ratios.map((ratio) => ({
    ratio,
    notionalUsd: flujoNetoUsd * ratio,
    tasaForward: forward,
    puntos: forward - trm,
  }));
}
