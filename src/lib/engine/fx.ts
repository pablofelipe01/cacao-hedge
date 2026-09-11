/**
 * Conversiones de moneda y precio efectivo del físico.
 *
 * El exportador vive con un descalce estructural: vende en USD y paga
 * en COP. Una revaluación del peso reduce sus ingresos aunque el precio
 * del cacao no se mueva un dólar.
 */

import { KG_POR_TONELADA } from "./constantes";
import type { Lote } from "./tipos";

/** COP → USD a una TRM dada. */
export function copAUsd(montoCop: number, trm: number): number {
  if (trm <= 0) throw new Error("La TRM debe ser mayor que cero.");
  return montoCop / trm;
}

/** USD → COP a una TRM dada. */
export function usdACop(montoUsd: number, trm: number): number {
  if (trm <= 0) throw new Error("La TRM debe ser mayor que cero.");
  return montoUsd * trm;
}

/** Costo de adquisición expresado por tonelada: COP/kg → COP/TM. */
export function costoCopTm(costoCopKg: number): number {
  return costoCopKg * KG_POR_TONELADA;
}

/** Costo total de adquisición del lote, en COP. */
export function costoAdquisicionCop(toneladas: number, costoCopKg: number): number {
  return toneladas * costoCopTm(costoCopKg);
}

/** Costo de adquisición por tonelada expresado en USD a una TRM dada. */
export function costoUsdTm(costoCopKg: number, trm: number): number {
  return copAUsd(costoCopTm(costoCopKg), trm);
}

/**
 * Precio al que se vende realmente el físico, USD/TM.
 *
 * Con contrato a precio fijo el precio está cerrado y no depende del
 * futuro: en ese caso el riesgo que queda es únicamente cambiario. En
 * los demás casos el precio es futuro ± diferencial, y por eso la
 * cobertura con futuros nunca elimina el riesgo de base.
 */
export function precioFisicoUsdTm(
  lote: Pick<Lote, "tipoContrato" | "precioVentaUsdTm">,
  futuroUsdTm: number,
  diferencialUsdTm: number,
): number {
  if (lote.tipoContrato === "precio_fijo_usd") {
    if (lote.precioVentaUsdTm == null) {
      throw new Error(
        "Un contrato a precio fijo requiere precioVentaUsdTm.",
      );
    }
    return lote.precioVentaUsdTm;
  }
  return futuroUsdTm + diferencialUsdTm;
}

/**
 * Punto de equilibrio: precio de venta en USD/TM que iguala el costo de
 * adquisición a la TRM dada. Por debajo de ese precio el lote pierde
 * plata aunque el negocio "parezca" rentable en dólares.
 */
export function precioEquilibrioUsdTm(costoCopKg: number, trm: number): number {
  return costoUsdTm(costoCopKg, trm);
}
