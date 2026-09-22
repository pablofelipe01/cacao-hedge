/**
 * Constantes del contrato de referencia y del dominio.
 *
 * Contrato: Cacao, ICE Futures US (Nueva York), símbolo CC.
 * Fuente: especificación del contrato de ICE.
 */

/** Toneladas métricas cubiertas por un contrato CC. */
export const CC_TONELADAS_POR_CONTRATO = 10;

/** El CC cotiza en dólares por tonelada métrica. */
export const CC_UNIDAD_COTIZACION = "USD/TM" as const;

/** Tick mínimo de precio: 1 USD por tonelada métrica. */
export const CC_TICK_USD_TM = 1;

/** Valor monetario de un tick completo: 1 USD/TM × 10 TM = 10 USD. */
export const CC_VALOR_TICK_USD = CC_TICK_USD_TM * CC_TONELADAS_POR_CONTRATO;

/**
 * Meses de vencimiento del CC con su código ICE.
 * El cacao no cotiza todos los meses: solo estos cinco.
 */
export const CC_MESES_VENCIMIENTO = [
  { codigo: "H", mes: 3, nombre: "marzo" },
  { codigo: "K", mes: 5, nombre: "mayo" },
  { codigo: "N", mes: 7, nombre: "julio" },
  { codigo: "U", mes: 9, nombre: "septiembre" },
  { codigo: "Z", mes: 12, nombre: "diciembre" },
] as const;

export type CodigoMesCC = (typeof CC_MESES_VENCIMIENTO)[number]["codigo"];

/** Símbolo del continuo de cacao en Yahoo Finance (fallback gratuito). */
export const SIMBOLO_CONTINUO_YAHOO = "CC=F";

/** Símbolo con el que se cachea la TRM oficial en la tabla `precios`. */
export const SIMBOLO_TRM = "USDCOP";

/** Kilogramos por tonelada métrica: convierte el costo COP/kg a COP/TM. */
export const KG_POR_TONELADA = 1000;

/**
 * Días hábiles bursátiles al año. Base para anualizar volatilidad diaria
 * y para escalar el VaR al horizonte del embarque.
 */
export const DIAS_HABILES_ANIO = 252;

/**
 * Cuántas veces el margen de mantenimiento cabe en el inicial.
 *
 * ICE fija el margen inicial del CC en un 110 % del de mantenimiento para
 * las cuentas especulativas. El exportador conoce el inicial —es lo que
 * StoneX le retiene al abrir— pero no el de mantenimiento, y pedírselo era
 * pedirle un número que no tenía. Se deriva con esta relación.
 *
 * Una cuenta calificada como de cobertura tiene los dos iguales; derivar
 * con 110 % hace llegar la llamada de margen un poco antes, que es el lado
 * prudente del error.
 */
export const RELACION_MARGEN_INICIAL_MANTENIMIENTO = 1.1;

/** El margen de mantenimiento que corresponde a un margen inicial. */
export function margenMantenimientoDesdeInicial(margenInicialUsd: number): number {
  return Math.round((margenInicialUsd / RELACION_MARGEN_INICIAL_MANTENIMIENTO) * 100) / 100;
}
