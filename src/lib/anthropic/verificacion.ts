/**
 * Verificación de que el informe no inventó cifras.
 *
 * El prompt de sistema le prohíbe al modelo calcular o inventar números,
 * pero una instrucción es una petición, no una garantía. Esto lo
 * comprueba: se extrae cada cifra del texto generado y se busca en el
 * resumen cuantitativo que se le entregó. Lo que no rastree a un dato de
 * entrada se reporta.
 *
 * El criterio es deliberadamente permisivo con la FORMA (un mismo valor
 * puede escribirse 656.843.211, «656,8 millones» o «657 M») y estricto
 * con el FONDO: si el número no sale de los datos, se marca.
 */

export interface NumeroCitado {
  /** Tal como aparece en el texto. */
  textual: string;
  /** Valor interpretado en convención colombiana. */
  valor: number;
  /** Decimales con que se escribió: define la tolerancia del cotejo. */
  decimales: number;
  /** Fragmento alrededor, para poder señalar dónde está. */
  contexto: string;
}

/**
 * Números en notación colombiana: punto para miles, coma para decimales.
 * Se exige que los grupos de miles sean de tres cifras para no confundir
 * «5.9» (cinco coma nueve mal escrito) con «5.961» (cinco mil...).
 */
const PATRON_NUMERO = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/g;

/** Un año suelto entre 2000 y 2099 casi siempre es una fecha, no una cifra. */
const PATRON_FECHA = /\b(?:19|20)\d{2}\b/;

/** Interpreta una cadena en convención colombiana. */
export function aNumeroColombiano(textual: string): number {
  return Number(textual.replace(/\./g, "").replace(",", "."));
}

/** Cuántos decimales lleva escrito el número. */
function decimalesDe(textual: string): number {
  const coma = textual.indexOf(",");
  return coma === -1 ? 0 : textual.length - coma - 1;
}

/** true si el número está pegado a letras: forma parte de un identificador. */
function dentroDeIdentificador(texto: string, inicio: number, largo: number): boolean {
  const antes = texto[inicio - 1] ?? "";
  const despues = texto[inicio + largo] ?? "";
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(antes) || /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(despues);
}

/** Extrae todas las cifras citadas en el texto, ignorando años sueltos. */
export function extraerNumeros(texto: string): NumeroCitado[] {
  const salida: NumeroCitado[] = [];

  for (const coincidencia of texto.matchAll(PATRON_NUMERO)) {
    const textual = coincidencia[0];
    const inicio = coincidencia.index ?? 0;

    // Un año dentro de una fecha ISO o suelto no es una cifra del análisis.
    if (PATRON_FECHA.test(textual) && !textual.includes(",")) continue;

    // "26" dentro de "CCZ26" es parte del nombre del contrato, no una cifra.
    if (dentroDeIdentificador(texto, inicio, textual.length)) continue;

    const valor = aNumeroColombiano(textual);
    if (!Number.isFinite(valor)) continue;

    salida.push({
      textual,
      valor,
      decimales: decimalesDe(textual),
      contexto: texto.slice(Math.max(0, inicio - 45), inicio + textual.length + 25).replace(/\s+/g, " ").trim(),
    });
  }

  return salida;
}

/**
 * Recorre el resumen y recoge todos los valores numéricos que contiene,
 * incluidos los que viven dentro de cadenas.
 *
 * Los nombres de estrategia llevan cifras reales —«Put protector strike
 * 5375», «Venta de futuros 100 %»—, igual que las advertencias y las
 * fechas. El modelo puede citarlas legítimamente porque se las dimos
 * nosotros; ignorar las cadenas las marcaría como inventadas.
 */
export function valoresPermitidos(resumen: unknown, acumulado = new Set<number>()): Set<number> {
  if (typeof resumen === "number" && Number.isFinite(resumen)) {
    acumulado.add(resumen);
  } else if (typeof resumen === "string") {
    // Se aceptan ambas convenciones: el JSON mezcla textos en español con
    // fechas ISO y símbolos como CCZ26.
    for (const trozo of resumen.matchAll(/\d+(?:[.,]\d+)?/g)) {
      const valor = Number(trozo[0].replace(",", "."));
      if (Number.isFinite(valor)) acumulado.add(valor);
    }
  } else if (Array.isArray(resumen)) {
    for (const elemento of resumen) valoresPermitidos(elemento, acumulado);
  } else if (resumen && typeof resumen === "object") {
    for (const valor of Object.values(resumen)) valoresPermitidos(valor, acumulado);
  }
  return acumulado;
}

/** Redondea igual que lo haría quien escribe la cifra. */
function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/**
 * ¿La cifra citada corresponde a algún valor permitido?
 *
 * Se aceptan las escalas con que se abrevian los pesos —unidades, miles,
 * millones y miles de millones— y el valor absoluto, porque una pérdida
 * suele redactarse en positivo («una pérdida de 333 millones»).
 */
export function esCifraRastreable(
  citado: NumeroCitado,
  permitidos: Iterable<number>,
): boolean {
  const escalas = [1, 1e3, 1e6, 1e9];

  for (const permitido of permitidos) {
    for (const candidato of [permitido, Math.abs(permitido)]) {
      for (const escala of escalas) {
        if (redondear(candidato / escala, citado.decimales) === citado.valor) return true;
      }
    }
  }

  return false;
}

export interface ResultadoVerificacion {
  totalCitadas: number;
  rastreables: number;
  /** Cifras que no se encontraron en los datos de entrada. */
  sospechosas: NumeroCitado[];
  /** true si todas las cifras del informe salen de los datos. */
  limpio: boolean;
}

/**
 * Comprueba que toda cifra del informe proviene del resumen entregado.
 *
 * No corrige ni censura: reporta. La decisión de qué hacer con un informe
 * que cita cifras no rastreables es de la aplicación, y el usuario merece
 * enterarse de que las hay.
 */
export function verificarCifras(
  texto: string,
  resumen: unknown,
): ResultadoVerificacion {
  const permitidos = valoresPermitidos(resumen);
  const citadas = extraerNumeros(texto);
  const sospechosas = citadas.filter((c) => !esCifraRastreable(c, permitidos));

  return {
    totalCitadas: citadas.length,
    rastreables: citadas.length - sospechosas.length,
    sospechosas,
    limpio: sospechosas.length === 0,
  };
}
