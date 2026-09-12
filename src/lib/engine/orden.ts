/**
 * Texto de la orden para enviarle al bróker.
 *
 * El exportador no opera por una plataforma: le escribe a su ejecutivo de
 * StoneX por WhatsApp. Ese mensaje escrito a mano es el punto más frágil
 * de toda la cadena —un «compra» donde iba «vende», un cero de más en los
 * contratos— y es justo donde la herramienta no estaba ayudando en nada.
 *
 * Aquí se redacta a partir de la estrategia YA calculada, con sus patas,
 * sus strikes y su vencimiento, para que lo que el cliente copia diga
 * exactamente lo que el análisis recomendó.
 *
 * Tres límites deliberados. No envía nada: produce texto que una persona
 * revisa y manda. No inventa precios: el límite lo pone el usuario, y si
 * no lo pone se usa el futuro de referencia diciendo de dónde salió. Y
 * las primas van siempre marcadas como ESTIMADAS, porque salen de
 * Black-76 con volatilidad histórica y no de una pantalla de mercado:
 * quien cotiza es la mesa.
 */

import { CC_MESES_VENCIMIENTO, CC_TONELADAS_POR_CONTRATO } from "./constantes";
import { sentidoDe, type Estrategia, type TipoOperacion } from "./tipos";

/** Vigencia de la orden, en el vocabulario que usan las mesas. */
export type VigenciaOrden = "dia" | "gtc";

/** Una pata de la orden: qué se compra o se vende, y de qué. */
export interface PataOrden {
  accion: "COMPRA" | "VENTA";
  instrumento: "FUTURO" | "PUT" | "CALL";
  contratos: number;
  /** Strike en USD/TM. Ausente en futuros. */
  strikeUsdTm?: number;
}

export interface DatosOrden {
  estrategia: Estrategia;
  /** Símbolo de la serie usada en el análisis, p. ej. "CCZ26". */
  simbolo: string;
  /** Futuro de referencia del análisis, USD/TM. */
  futuroReferenciaUsdTm: number;
  operacion: TipoOperacion;
  /** Toneladas físicas de la operación, para dar contexto al bróker. */
  toneladas: number;
  /** Fecha de embarque o entrega, aaaa-mm-dd. Define el horizonte. */
  fechaEmbarque?: string;
  /** Número de cuenta en la casa de bolsa. Vacío = se deja marcado. */
  cuenta?: string;
  /** Precio límite del futuro, USD/TM. Ausente = el de referencia. */
  precioLimiteUsdTm?: number | null;
  /** Prima máxima que acepta pagar por TM, en estructuras con opciones. */
  primaMaximaUsdTm?: number | null;
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
 * Toneladas para un mensaje que leerá una mesa de operaciones.
 *
 * Nunca fuerza decimales. Con `minimumFractionDigits: 3`, 40 toneladas se
 * escribían «40,000 TM», y un ejecutivo acostumbrado a la convención
 * inglesa lee ahí cuarenta mil. En un texto que se convierte en orden esa
 * ambigüedad no es un detalle de formato.
 */
function toneladas(x: number): string {
  return x.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  if (!a || !m || !d || m < 1 || m > 12) return iso;
  return `${d} de ${MESES[m - 1]} de ${a}`;
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
 * Las patas que hay que pedirle a la mesa para montar una estrategia.
 *
 * Es la traducción del nombre de la estrategia a instrucciones: un
 * «collar inverso 6250 / 5725» son dos órdenes distintas, y escribirlas
 * por separado es lo que evita que el cliente pida solo una y quede con
 * media estructura, que casi siempre es peor que no tener ninguna.
 */
export function patasDe(estrategia: Estrategia): PataOrden[] {
  const { tipo, contratos, sentido, strikePut, strikeCall } = estrategia;
  const compra = sentido === "larga";

  switch (tipo) {
    case "futuros":
    case "escalonada":
      return [{ accion: compra ? "COMPRA" : "VENTA", instrumento: "FUTURO", contratos }];

    case "put_protector":
      return [{ accion: "COMPRA", instrumento: "PUT", contratos, strikeUsdTm: strikePut }];

    case "call_protector":
      return [{ accion: "COMPRA", instrumento: "CALL", contratos, strikeUsdTm: strikeCall }];

    // Inventario: se compra el piso y se vende el techo para pagarlo.
    case "collar":
      return [
        { accion: "COMPRA", instrumento: "PUT", contratos, strikeUsdTm: strikePut },
        { accion: "VENTA", instrumento: "CALL", contratos, strikeUsdTm: strikeCall },
      ];

    // Compra pendiente: se compra el techo y se vende el piso. Espejo exacto.
    case "collar_inverso":
      return [
        { accion: "COMPRA", instrumento: "CALL", contratos, strikeUsdTm: strikeCall },
        { accion: "VENTA", instrumento: "PUT", contratos, strikeUsdTm: strikePut },
      ];

    case "sin_cobertura":
      return [];
  }
}

/** ¿Hay algo que pedirle a la mesa? Solo «no cubrirse» no requiere orden. */
export function admiteTextoDeOrden(estrategia: Estrategia): boolean {
  return patasDe(estrategia).length > 0 && estrategia.contratos > 0;
}

/** ¿La estructura lleva opciones? Cambia qué se cotiza y cómo. */
export function usaOpciones(estrategia: Estrategia): boolean {
  return patasDe(estrategia).some((p) => p.instrumento !== "FUTURO");
}

function describirPata(pata: PataOrden, simbolo: string): string {
  const lado = pata.accion === "COMPRA" ? "BUY" : "SELL";
  const sim = simbolo.toUpperCase();

  if (pata.instrumento === "FUTURO") {
    const plural = pata.contratos === 1 ? "contrato" : "contratos";
    return `${pata.accion} (${lado}) de ${pata.contratos} ${plural} de futuro ${sim}`;
  }

  const plural = pata.contratos === 1 ? "opción" : "opciones";
  const strike =
    pata.strikeUsdTm != null ? `${numero(pata.strikeUsdTm)} USD/TM` : PENDIENTE;
  return `${pata.accion} (${lado}) de ${pata.contratos} ${plural} ${pata.instrumento} sobre ${sim}, strike ${strike}`;
}

/**
 * Redacta el mensaje listo para copiar y pegar.
 *
 * @throws si la estrategia no requiere ninguna orden, o si el sentido de
 *         la operación y el de la estrategia se contradicen.
 */
export function textoOrdenBroker(datos: DatosOrden): string {
  const { estrategia, operacion } = datos;

  const patas = patasDe(estrategia);
  if (patas.length === 0 || estrategia.contratos <= 0) {
    throw new Error("No cubrirse no requiere ninguna orden.");
  }

  // `operacion` y `estrategia.sentido` describen el mismo hecho por dos
  // caminos distintos, y aquí eso deja de ser redundancia inútil: si
  // alguna vez discrepan, el texto diría COMPRA donde va VENTA y alguien
  // mandaría esa orden. Reventar es mucho mejor que redactarla.
  if (sentidoDe(operacion) !== estrategia.sentido) {
    throw new Error(
      `Incoherencia en el sentido de la cobertura: la operación «${operacion}» exige una cobertura ${sentidoDe(operacion)} y la estrategia dice «${estrategia.sentido}». No se redacta la orden.`,
    );
  }

  const compra = estrategia.sentido === "larga";
  const conOpciones = usaOpciones(estrategia);
  const vigencia =
    datos.vigencia === "dia" ? "válida solo por hoy (DAY)" : "válida hasta cancelar (GTC)";

  const lineas = [
    "Hola, buen día.",
    "",
    `Necesito montar ${conOpciones ? "la siguiente estructura" : "la siguiente orden"}: ${estrategia.nombre}.`,
    "",
    `Cuenta: ${datos.cuenta?.trim() || PENDIENTE}`,
    `Producto: Cacao ICE Futures US (CC) — ${describirVencimiento(datos.simbolo)}`,
  ];

  if (datos.fechaEmbarque) {
    lineas.push(
      `Horizonte: mi ${compra ? "compra del físico" : "embarque"} es el ${fechaLarga(datos.fechaEmbarque)}` +
        (conOpciones
          ? ", así que necesito la serie de opciones que llegue hasta esa fecha."
          : "."),
    );
  }

  lineas.push("");

  if (patas.length === 1) {
    lineas.push(`Operación: ${describirPata(patas[0], datos.simbolo)}`);
  } else {
    lineas.push(`Operación: ${patas.length} patas, a ejecutar JUNTAS:`);
    patas.forEach((pata, i) => {
      lineas.push(`  ${i + 1}. ${describirPata(pata, datos.simbolo)}`);
    });
  }

  lineas.push(
    `Equivale a ${numero(estrategia.contratos * CC_TONELADAS_POR_CONTRATO)} TM cubiertas.`,
  );

  // --- Precio o prima ---------------------------------------------------
  if (conOpciones) {
    // La prima del motor sale de Black-76 con volatilidad histórica. No es
    // una cotización, y presentarla como si lo fuera pondría al cliente a
    // discutir con la mesa un número que nunca fue de mercado.
    if (estrategia.primaNetaUsdTm != null) {
      const neta = estrategia.primaNetaUsdTm;
      lineas.push(
        `Prima neta estimada por mi modelo: ${numero(Math.abs(neta), 2)} USD/TM ` +
          `${neta >= 0 ? "a pagar" : "a recibir (crédito)"} ` +
          `(~${numero(Math.abs(estrategia.costoInicialUsd))} USD en total). ` +
          "Es una referencia teórica, no una cotización: por favor indíquenme su precio.",
      );
    }
    if (datos.primaMaximaUsdTm != null) {
      lineas.push(`Prima máxima que acepto pagar: ${numero(datos.primaMaximaUsdTm, 2)} USD/TM.`);
    }
  } else {
    const limite = datos.precioLimiteUsdTm ?? datos.futuroReferenciaUsdTm;
    lineas.push(`Tipo de orden: LIMIT a ${numero(limite)} USD/TM`);
  }

  lineas.push(`Vigencia: ${vigencia}`);

  if (datos.precioStopUsdTm != null && !conOpciones) {
    lineas.push(`Stop: ${numero(datos.precioStopUsdTm)} USD/TM`);
  }

  // --- Notas propias de cada estructura ---------------------------------
  if (patas.length > 1) {
    lineas.push(
      "",
      `Importante: las ${patas.length} patas van juntas. Si entra solo una quedo ` +
        `${compra ? "expuesto a la subida, o vendido en descubierto" : "descubierto, o vendido en descubierto"}` +
        ", que es lo contrario de lo que busco.",
    );
  }

  if (estrategia.tipo === "escalonada" && estrategia.tramos) {
    const reparteParejo = estrategia.contratos % estrategia.tramos === 0;
    lineas.push(
      "",
      `No es una ejecución única: quiero repartirla en ${estrategia.tramos} tramos espaciados ` +
        `hasta mi fecha de ${compra ? "compra" : "embarque"}, para promediar el precio.` +
        (reparteParejo
          ? ` Serían ${estrategia.contratos / estrategia.tramos} contrato(s) por tramo.`
          : ` Como son ${estrategia.contratos} contratos en ${estrategia.tramos} tramos no reparte parejo: díganme cómo lo cuadramos.`),
      "¿Pueden programarlos ustedes, o se los voy enviando uno por uno?",
    );
  }

  // --- Contexto y cierre -------------------------------------------------
  const contexto = compra
    ? `Es una cobertura de compra: tengo una venta cerrada de ${toneladas(datos.toneladas)} TM pendiente de abastecer y quiero fijar el costo.`
    : `Es una cobertura de venta: tengo ${toneladas(datos.toneladas)} TM de cacao en bodega y quiero fijar el precio.`;

  lineas.push("", contexto);

  if (datos.disparadorMargenUsdTm != null && !conOpciones) {
    // El bróker no sabe cuánta caja tiene el cliente; decirle a qué nivel
    // se espera la primera llamada evita la llamada sorpresa del lunes.
    lineas.push(
      "",
      `Según mi análisis, la primera llamada de margen llegaría si el futuro ${
        compra ? "baja" : "sube"
      } a ${numero(datos.disparadorMargenUsdTm)} USD/TM.`,
    );
  }

  lineas.push(
    "",
    conOpciones
      ? "Por favor cotícenme la estructura completa y confírmenme el margen requerido."
      : "Por favor confírmame la ejecución y el margen inicial requerido.",
    "Gracias.",
  );

  return lineas.join("\n");
}
