/**
 * Precios de compra que publican Compañía Nacional de Chocolates y Casa
 * Luker, desde la hoja de seguimiento del exportador.
 *
 * Estos dos compradores fijan el precio en pesos del cacao colombiano.
 * No es un mercado: es un precio administrado que ellos publican y que el
 * exportador tiene que igualar para conseguir grano. Por eso el
 * diferencial contra Nueva York no es una fórmula pactada sino una
 * relación observada, y por eso hay que medirla en vez de suponerla.
 *
 * Lo medido sobre dos años de esta hoja: el precio en pesos sigue a Nueva
 * York con beta 0,96 y a la TRM con beta 0,87, sin rezago apreciable y
 * con R² de 0,88. El descuento medio es −23 %, pero oscila entre −15 % y
 * −32 %: ese 12 % que no explican ni la bolsa ni el dólar es el riesgo de
 * base, y es la parte que ninguna cobertura con futuros toca.
 *
 * Forma de la hoja: las fechas van en FILAS, no en columnas. Cada columna
 * es un día, de más reciente a más antiguo.
 */

import { ErrorDatos } from "./errores";
import { obtenerTexto, type OpcionesPeticion } from "./http";
import { parsearCsv } from "./hoja-inventario";

const NOMBRE = "Hoja de precios de compra";

/** Hoja de seguimiento del exportador, compartida por enlace. */
export const HOJA_PRECIOS_POR_DEFECTO = "1aNoSXKt7kgfEFTu3EoSgil5yr4DICpiDjDu6eacjmro";

/** Un comprador y su calidad, tal como los publica la hoja. */
export type Comprador =
  | "luker_bajo_cadmio"
  | "luker_alto_cadmio"
  | "nacional_bogota"
  | "nacional_ibague";

export const COMPRADORES: { clave: Comprador; etiqueta: string }[] = [
  { clave: "luker_bajo_cadmio", etiqueta: "Casa Luker · bajo cadmio" },
  { clave: "luker_alto_cadmio", etiqueta: "Casa Luker · alto cadmio" },
  { clave: "nacional_bogota", etiqueta: "Nacional de Chocolates · Bogotá" },
  { clave: "nacional_ibague", etiqueta: "Nacional de Chocolates · Ibagué" },
];

/** Un precio publicado para una fecha, en COP/kg. */
export interface PrecioProductor {
  fecha: string;
  comprador: Comprador;
  precioCopKg: number;
}

export interface PreciosHoja {
  precios: PrecioProductor[];
  /** Fecha más reciente con al menos un precio. */
  ultimaFecha: string | null;
  /** Columnas cuya cabecera no se pudo interpretar como fecha. */
  fechasIlegibles: number;
  advertencias: string[];
}

/**
 * Filas donde vive cada comprador, 0-indexadas.
 *
 * Van fijas y verificadas contra la etiqueta de la columna A porque la
 * hoja la mantiene una persona a mano: si alguien inserta una fila, es
 * mejor fallar ruidosamente que leer el precio del alto cadmio creyendo
 * que es el del bajo.
 */
const FILAS: { indice: number; comprador: Comprador; etiqueta: RegExp }[] = [
  { indice: 9, comprador: "luker_bajo_cadmio", etiqueta: /bajo\s*cadmio/i },
  { indice: 10, comprador: "luker_alto_cadmio", etiqueta: /alto\s*cadmio/i },
  { indice: 11, comprador: "nacional_bogota", etiqueta: /premium/i },
  { indice: 12, comprador: "nacional_ibague", etiqueta: /premium/i },
];

/** Fila de la hoja donde están las fechas. */
const FILA_FECHAS = 8;

const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};

/**
 * Interpreta una fecha de la cabecera: «11-sept-26», «4-sep-25».
 *
 * Las columnas viejas traen rangos de semana («4 al 10 Jun-20») que no
 * corresponden a un día concreto; esas se descartan en vez de inventarles
 * una fecha, y se cuentan para poder decirlo.
 */
export function fechaDeCabecera(valor: string | undefined): string | null {
  const texto = (valor ?? "").trim().toLowerCase();
  const m = /^(\d{1,2})-([a-záéíóú]+)\.?-(\d{2})$/.exec(texto);
  if (!m) return null;

  const [, dia, mes, anio] = m;
  const numeroMes = MESES[mes.slice(0, 4)] ?? MESES[mes.slice(0, 3)];
  if (!numeroMes) return null;

  const d = Number(dia);
  if (d < 1 || d > 31) return null;

  return `20${anio}-${String(numeroMes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Interpreta un precio: «$15.650» a la colombiana. */
export function precioDeCelda(valor: string | undefined): number | null {
  const limpio = (valor ?? "").replace(/[$\s]/g, "").trim();
  if (limpio === "" || limpio.startsWith("#")) return null;

  // Los miles van con punto y no hay decimales: «15.650» son quince mil.
  const n = Number(limpio.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;

  // Un precio de cacao en COP/kg vive entre unos pocos miles y ~50.000.
  // Fuera de ahí es una celda de otra cosa que se coló en la fila.
  return n >= 1000 && n <= 100000 ? n : null;
}

/** Interpreta la hoja ya descargada. */
export function interpretarHojaPrecios(csv: string): PreciosHoja {
  const filas = parsearCsv(csv);
  const advertencias: string[] = [];

  if (filas.length <= FILA_FECHAS) {
    throw new ErrorDatos(
      NOMBRE,
      "respuesta_invalida",
      `La hoja tiene ${filas.length} filas y las fechas deberían estar en la ${FILA_FECHAS + 1}. ¿Cambió de formato?`,
    );
  }

  // Verificar que cada fila sigue siendo la que creemos: la hoja la
  // mantiene una persona, y una fila insertada movería todos los precios.
  for (const { indice, comprador, etiqueta } of FILAS) {
    const rotulo = filas[indice]?.[0] ?? "";
    if (!etiqueta.test(rotulo)) {
      throw new ErrorDatos(
        NOMBRE,
        "respuesta_invalida",
        `La fila ${indice + 1} debería ser «${comprador}» pero dice «${rotulo}». La hoja cambió de estructura: revísela antes de sincronizar, porque leer el precio equivocado es peor que no leer ninguno.`,
      );
    }
  }

  const cabecera = filas[FILA_FECHAS];
  const precios: PrecioProductor[] = [];
  let fechasIlegibles = 0;

  for (let col = 1; col < cabecera.length; col++) {
    const fecha = fechaDeCabecera(cabecera[col]);
    if (!fecha) {
      if ((cabecera[col] ?? "").trim() !== "") fechasIlegibles++;
      continue;
    }

    for (const { indice, comprador } of FILAS) {
      const precio = precioDeCelda(filas[indice]?.[col]);
      if (precio != null) precios.push({ fecha, comprador, precioCopKg: precio });
    }
  }

  if (precios.length === 0) {
    throw new ErrorDatos(
      NOMBRE,
      "sin_datos",
      "No se pudo leer ningún precio de la hoja.",
    );
  }

  if (fechasIlegibles > 0) {
    advertencias.push(
      `${fechasIlegibles} columnas traen rangos de semana en vez de un día concreto («4 al 10 Jun-20») y se omitieron: sin fecha exacta no se pueden cruzar con la bolsa.`,
    );
  }

  const fechas = [...new Set(precios.map((p) => p.fecha))].sort();

  return {
    precios,
    ultimaFecha: fechas[fechas.length - 1] ?? null,
    fechasIlegibles,
    advertencias,
  };
}

/** URL de exportación a CSV de una hoja de Google. */
function urlExportacion(hojaId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(hojaId)}/export?format=csv`;
}

/** Descarga la hoja de precios y la interpreta. */
export async function descargarPrecios(
  hojaId: string,
  opciones: Partial<OpcionesPeticion> = {},
): Promise<PreciosHoja> {
  const csv = await obtenerTexto(urlExportacion(hojaId), { proveedor: NOMBRE, ...opciones });

  if (/^\s*</.test(csv)) {
    throw new ErrorDatos(
      NOMBRE,
      "no_autorizado",
      "La hoja no es accesible por enlace: Google devolvió una página de acceso en vez del CSV. Compártala como «cualquiera con el enlace puede ver».",
    );
  }

  return interpretarHojaPrecios(csv);
}

// ---------------------------------------------------------------------
// El descuento contra Nueva York
// ---------------------------------------------------------------------

export interface DescuentoObservado {
  fecha: string;
  comprador: Comprador;
  /** Precio publicado, COP/kg. */
  precioCopKg: number;
  /** El mismo precio llevado a USD/TM con la TRM de ese día. */
  precioUsdTm: number;
  futuroUsdTm: number;
  /** Fracción: −0,153 = 15,3 % por debajo de la bolsa. */
  descuento: number;
}

/**
 * Cruza el precio publicado con la bolsa y la TRM del mismo día.
 *
 * Solo usa días en que existen las tres cifras. Interpolar el futuro o la
 * TRM para rellenar huecos produciría descuentos que nadie observó, y el
 * punto de todo esto es sustituir una suposición por una medición.
 */
export function calcularDescuentos(
  precios: readonly PrecioProductor[],
  futuroPorFecha: ReadonlyMap<string, number>,
  trmPorFecha: ReadonlyMap<string, number>,
): DescuentoObservado[] {
  const salida: DescuentoObservado[] = [];

  for (const p of precios) {
    const futuro = futuroPorFecha.get(p.fecha);
    const trm = trmPorFecha.get(p.fecha);
    if (futuro == null || trm == null || futuro <= 0 || trm <= 0) continue;

    // COP/kg -> USD/TM: x1000 kg por tonelada, entre la TRM del día.
    const precioUsdTm = (p.precioCopKg * 1000) / trm;
    salida.push({
      fecha: p.fecha,
      comprador: p.comprador,
      precioCopKg: p.precioCopKg,
      precioUsdTm,
      futuroUsdTm: futuro,
      descuento: precioUsdTm / futuro - 1,
    });
  }

  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export interface ResumenDescuento {
  comprador: Comprador;
  /** Observaciones usadas. */
  dias: number;
  /** El más reciente, que es el que el formulario propone. */
  actual: number;
  fechaActual: string;
  mediana: number;
  /** Percentiles 5 y 95: el rango que debería simular la matriz. */
  p5: number;
  p95: number;
  minimo: number;
  maximo: number;
}

function percentil(ordenados: readonly number[], q: number): number {
  if (ordenados.length === 0) return Number.NaN;
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.floor(q * ordenados.length)));
  return ordenados[i];
}

/**
 * Resume la distribución del descuento de un comprador.
 *
 * Devuelve el actual y el rango, porque son dos decisiones distintas: el
 * actual alimenta el análisis, y el rango debería alimentar el eje de
 * base de la matriz de escenarios, que hoy está clavado en ±100 USD/TM.
 */
export function resumirDescuento(
  observados: readonly DescuentoObservado[],
  comprador: Comprador,
): ResumenDescuento | null {
  const propios = observados.filter((d) => d.comprador === comprador);
  if (propios.length === 0) return null;

  const valores = propios.map((d) => d.descuento);
  const ordenados = [...valores].sort((a, b) => a - b);
  const ultimo = propios[propios.length - 1];

  return {
    comprador,
    dias: propios.length,
    actual: ultimo.descuento,
    fechaActual: ultimo.fecha,
    mediana: percentil(ordenados, 0.5),
    p5: percentil(ordenados, 0.05),
    p95: percentil(ordenados, 0.95),
    minimo: ordenados[0],
    maximo: ordenados[ordenados.length - 1],
  };
}
