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
 * Precio efectivo del físico en un escenario, USD/TM.
 *
 * Con inventario sin vender es el precio al que VENDE; con una venta ya
 * cerrada es el precio al que COMPRA al productor. En ambos casos es
 * futuro ± diferencial, y por eso la cobertura con futuros nunca elimina
 * el riesgo de base.
 *
 * La excepción es el inventario ya vendido a precio fijo en USD: ahí el
 * precio está cerrado y no depende del futuro, así que lo único vivo es
 * el riesgo cambiario.
 */
export function precioFisicoUsdTm(
  lote: Pick<Lote, "tipoContrato" | "precioVentaUsdTm" | "tipoOperacion">,
  futuroUsdTm: number,
  diferencialUsdTm: number,
): number {
  const esInventario = (lote.tipoOperacion ?? "inventario_sin_vender") === "inventario_sin_vender";

  if (esInventario && lote.tipoContrato === "precio_fijo_usd") {
    if (lote.precioVentaUsdTm == null) {
      throw new Error("Un contrato a precio fijo requiere precioVentaUsdTm.");
    }
    return lote.precioVentaUsdTm;
  }

  return futuroUsdTm + diferencialUsdTm;
}

/**
 * Precio de venta ya pactado en una operación de venta sin comprar.
 *
 * Es el dato que da sentido a la operación: sin él no hay ingreso cerrado
 * que proteger y el caso no se sostiene.
 */
export function precioVentaPactadoUsdTm(
  lote: Pick<Lote, "precioVentaUsdTm">,
): number {
  if (lote.precioVentaUsdTm == null || lote.precioVentaUsdTm <= 0) {
    throw new Error(
      "Una venta ya cerrada requiere el precio pactado en USD/TM: es el ingreso que la cobertura protege.",
    );
  }
  return lote.precioVentaUsdTm;
}

/**
 * Punto de equilibrio de una venta ya cerrada: el precio máximo que puede
 * pagar por el físico sin perder plata, USD/TM.
 *
 * Es el espejo del punto de equilibrio del inventario. Allí el precio de
 * venta no puede bajar de cierto nivel; aquí el de compra no puede subir.
 */
export function precioMaximoCompraUsdTm(
  precioVentaUsdTm: number,
  diferencialUsdTm: number,
): number {
  return precioVentaUsdTm - diferencialUsdTm;
}

/**
 * Punto de equilibrio: precio de venta en USD/TM que iguala el costo de
 * adquisición a la TRM dada. Por debajo de ese precio el lote pierde
 * plata aunque el negocio "parezca" rentable en dólares.
 */
export function precioEquilibrioUsdTm(costoCopKg: number, trm: number): number {
  return costoUsdTm(costoCopKg, trm);
}
