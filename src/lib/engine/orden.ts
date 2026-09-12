/**
 * Texto de la orden para enviarle al bróker.
 *
 * El exportador no opera por una plataforma: le escribe a su ejecutivo de
 * StoneX por WhatsApp. Ese mensaje escrito a mano es el punto más frágil
 * de toda la cadena —un «compra» donde iba «vende», un cero de más en los
 * contratos— y es justo donde la herramienta no estaba ayudando en nada.
 *
 * Aquí se redacta a partir de la estrategia YA calculada, para que lo que
 * el cliente copia diga exactamente lo que el análisis recomendó.
 *
 * Dos límites deliberados. Este módulo no envía nada: produce texto que
 * una persona revisa y manda. Y no inventa precios: el límite lo pone el
 * usuario, y si no lo pone, se usa el futuro de referencia del análisis
 * diciendo de dónde salió.
 */

import { CC_MESES_VENCIMIENTO, CC_TONELADAS_POR_CONTRATO } from "./constantes";
import type { Estrategia, TipoOperacion } from "./tipos";

/** Vigencia de la orden, en el vocabulario que usan las mesas. */
export type VigenciaOrden = "dia" | "gtc";

export interface DatosOrden {
  estrategia: Estrategia;
  /** Símbolo de la serie usada en el análisis, p. ej. "CCZ26". */
  simbolo: string;
  /** Futuro de referencia del análisis, USD/TM. */
  futuroReferenciaUsdTm: number;
  operacion: TipoOperacion;
  /** Toneladas físicas de la operación, para dar contexto al bróker. */
  toneladas: number;
  /** Número de cuenta en la casa de bolsa. Vacío = se deja marcado. */
  cuenta?: string;
  /** Precio límite en USD/TM. Ausente = se usa el futuro de referencia. */
  precioLimiteUsdTm?: number | null;
  /** Stop opcional en USD/TM. Ausente = orden sin stop. */
  precioStopUsdTm?: number | null;
  vigencia?: VigenciaOrden;
  /** Precio al que el análisis anticipa la primera llamada de margen. */
  disparadorMargenUsdTm?: number | null;
}

/** Hueco que el usuario debe rellenar antes de enviar. */
const PENDIENTE = "[COMPLETAR]";

function numero(x: number, decimales = 0): string {
  return x.toLocaleString("es-CO", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/**
 * Traduce un símbolo tipo "CCZ26" a "diciembre de 2026 (CCZ26)".
 *
 * Si no reconoce el formato devuelve el símbolo tal cual: es preferible
 * que el bróker lea un símbolo crudo a que lea un mes inventado.
 */
export function describirVencimiento(simbolo: string): string {
  const m = /^CC([HKNUZ])(\d{2})$/i.exec(simbolo.trim());
  if (!m) return simbolo;

  const mes = CC_MESES_VENCIMIENTO.find((x) => x.codigo === m[1].toUpperCase());
  if (!mes) return simbolo;

  return `${mes.nombre} de 20${m[2]} (${simbolo.toUpperCase()})`;
}

/**
 * ¿Esta estrategia se ejecuta con futuros?
 *
 * Las de opciones necesitan strike y prima, que se negocian distinto; por
 * ahora el texto solo cubre futuros y lo dice cuando no aplica.
 */
export function admiteTextoDeOrden(estrategia: Estrategia): boolean {
  return estrategia.tipo === "futuros" && estrategia.contratos > 0;
}

/**
 * Redacta el mensaje listo para copiar y pegar.
 *
 * @throws si la estrategia no se ejecuta con futuros.
 */
export function textoOrdenBroker(datos: DatosOrden): string {
  const { estrategia, operacion } = datos;

  if (!admiteTextoDeOrden(estrategia)) {
    throw new Error(
      "El texto de orden solo cubre estrategias con futuros: las de opciones se negocian con strike y prima.",
    );
  }

  const compra = estrategia.sentido === "larga";
  const verbo = compra ? "COMPRA" : "VENTA";
  const lado = compra ? "BUY" : "SELL";

  const limite = datos.precioLimiteUsdTm ?? datos.futuroReferenciaUsdTm;
  const vigencia =
    datos.vigencia === "dia"
      ? "válida solo por hoy (DAY)"
      : "válida hasta cancelar (GTC)";

  const toneladasCubiertas = estrategia.contratos * CC_TONELADAS_POR_CONTRATO;

  const contexto = compra
    ? `Es una cobertura de compra: tengo una venta cerrada de ${numero(datos.toneladas, 3)} TM pendiente de abastecer y quiero fijar el costo.`
    : `Es una cobertura de venta: tengo ${numero(datos.toneladas, 3)} TM de cacao en bodega y quiero fijar el precio.`;

  const lineas = [
    "Hola, buen día.",
    "",
    "Necesito ingresar la siguiente orden:",
    "",
    `Cuenta: ${datos.cuenta?.trim() || PENDIENTE}`,
    `Producto: Cacao ICE Futures US (CC) — ${describirVencimiento(datos.simbolo)}`,
    `Operación: ${verbo} (${lado}) de ${estrategia.contratos} contrato${estrategia.contratos === 1 ? "" : "s"} = ${numero(toneladasCubiertas)} TM`,
    `Tipo de orden: LIMIT a ${numero(limite)} USD/TM`,
    `Vigencia: ${vigencia}`,
  ];

  if (datos.precioStopUsdTm != null) {
    lineas.push(`Stop: ${numero(datos.precioStopUsdTm)} USD/TM`);
  }

  lineas.push("", contexto, "");

  if (datos.disparadorMargenUsdTm != null) {
    // El bróker no sabe cuánta caja tiene el cliente; decirle a qué nivel
    // se espera la primera llamada evita la llamada sorpresa del lunes.
    lineas.push(
      `Según mi análisis, la primera llamada de margen llegaría si el futuro ${
        compra ? "baja" : "sube"
      } a ${numero(datos.disparadorMargenUsdTm)} USD/TM.`,
      "",
    );
  }

  lineas.push(
    "Por favor confírmame la ejecución y el margen inicial requerido.",
    "Gracias.",
  );

  return lineas.join("\n");
}
