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
/** Tipo mínimo para razonar sobre el diferencial de un lote. */
type LoteDiferencial = Pick<Lote, "diferencialUsdTm" | "diferencialPorcentual">;

/** ¿El diferencial se pactó como porcentaje del futuro? */
export function esDiferencialPorcentual(lote: LoteDiferencial): boolean {
  return lote.diferencialPorcentual != null;
}

/**
 * El diferencial en USD/TM que corresponde a un nivel de futuro dado.
 *
 * Con diferencial fijo devuelve siempre el mismo número. Con uno
 * porcentual lo recalcula contra ese futuro, que es exactamente lo que
 * pasa en la realidad: el descuento se fija el día de la compra contra
 * el cierre de ese día.
 */
export function diferencialEnEscenarioUsdTm(
  lote: LoteDiferencial,
  futuroUsdTm: number,
): number {
  return lote.diferencialPorcentual != null
    ? futuroUsdTm * lote.diferencialPorcentual
    : lote.diferencialUsdTm;
}

/**
 * Cuánto se mueve el precio del físico por cada dólar que se mueve el
 * futuro. Es el ratio de cobertura correcto.
 *
 * Con diferencial fijo vale 1: hay que cubrir cada tonelada. Con uno
 * porcentual vale (1 + fracción): quien compra un 23,5 % por debajo solo
 * necesita cubrir el 76,5 % de sus toneladas, y cubrir más es especular.
 */
export function factorExposicion(lote: LoteDiferencial): number {
  return lote.diferencialPorcentual != null ? 1 + lote.diferencialPorcentual : 1;
}

/** Toneladas realmente expuestas al precio de Nueva York. */
export function toneladasExpuestasAlPrecio(
  lote: Pick<Lote, "toneladas" | "diferencialUsdTm" | "diferencialPorcentual">,
): number {
  return lote.toneladas * factorExposicion(lote);
}

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
  lote: LoteDiferencial,
): number {
  // Con diferencial porcentual el techo se despeja, no se resta: el
  // precio de compra es F × (1 + p), así que F máximo = venta / (1 + p).
  // Restar el diferencial de hoy daría un techo demasiado bajo y haría
  // sonar la alarma de margen mucho antes de tiempo.
  return lote.diferencialPorcentual != null
    ? precioVentaUsdTm / (1 + lote.diferencialPorcentual)
    : precioVentaUsdTm - lote.diferencialUsdTm;
}

/**
 * Punto de equilibrio: precio de venta en USD/TM que iguala el costo de
 * adquisición a la TRM dada. Por debajo de ese precio el lote pierde
 * plata aunque el negocio "parezca" rentable en dólares.
 */
export function precioEquilibrioUsdTm(costoCopKg: number, trm: number): number {
  return costoUsdTm(costoCopKg, trm);
}
