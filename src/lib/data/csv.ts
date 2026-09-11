/**
 * Importación de históricos en CSV descargados de barchart.com.
 *
 * Es el camino que sí permite una cuenta estándar: la web deja bajar el
 * histórico aunque la API OnDemand no esté incluida. El formato varía
 * entre exportaciones (con o sin comillas, con columna de símbolo,
 * fechas en mm/dd/aaaa o ISO, pie de página con la marca de descarga),
 * así que el parser es deliberadamente tolerante y solo exige dos cosas:
 * una columna de fecha y una de cierre.
 */

import { ErrorDatos } from "./errores";
import { esFechaIso } from "./fechas";
import type { Barra, SerieHistorica } from "./tipos";
import type { TipoSerie } from "@/types/database";

const NOMBRE = "CSV de Barchart";

/** Nombres aceptados por columna, normalizados a minúsculas sin acentos. */
const ALIAS: Record<keyof Omit<Barra, "fecha"> | "fecha" | "simbolo", string[]> = {
  fecha: ["date", "fecha", "time", "trade date", "tradingday", "trading day"],
  apertura: ["open", "apertura", "open price"],
  maximo: ["high", "maximo", "max", "high price"],
  minimo: ["low", "minimo", "min", "low price"],
  // "latest" es el nombre que usa el export de futuros de barchart.com
  // para el precio de liquidación; "last" aparece en otros de sus exportes.
  cierre: [
    "close", "cierre", "last", "latest", "settle", "settlement",
    "close price", "last price", "ultimo", "cierre ajustado",
  ],
  volumen: ["volume", "volumen", "vol"],
  simbolo: ["symbol", "simbolo", "ticker", "contract"],
};

/** Quita acentos y espacios sobrantes para comparar encabezados. */
function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Detecta el separador de campos de un CSV.
 *
 * Barchart exporta con coma, pero Excel en configuración regional
 * española o colombiana reescribe el archivo con punto y coma. Como es
 * habitual abrir el CSV antes de subirlo, se detecta en vez de asumir:
 * gana el separador que aparece más veces en la primera línea no vacía.
 */
export function detectarSeparador(contenido: string): "," | ";" | "\t" {
  const primera = contenido.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";

  const conteos = {
    ",": (primera.match(/,/g) ?? []).length,
    ";": (primera.match(/;/g) ?? []).length,
    "\t": (primera.match(/\t/g) ?? []).length,
  } as const;

  let mejor: "," | ";" | "\t" = ",";
  for (const separador of [";", "\t"] as const) {
    if (conteos[separador] > conteos[mejor]) mejor = separador;
  }
  return mejor;
}

/**
 * Divide una línea CSV respetando comillas dobles.
 *
 * Se escribe a mano en vez de usar `split()` porque los exportes de
 * Barchart entrecomillan campos y algunos nombres de contrato llevan coma.
 */
export function dividirLineaCsv(linea: string, separador = ","): string[] {
  const campos: string[] = [];
  let actual = "";
  let entreComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const caracter = linea[i];

    if (caracter === '"') {
      // Dos comillas seguidas dentro de un campo son una comilla literal.
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (caracter === separador && !entreComillas) {
      campos.push(actual);
      actual = "";
    } else {
      actual += caracter;
    }
  }

  campos.push(actual);
  return campos.map((c) => c.trim());
}

/**
 * Convierte a número tolerando separadores de miles y campos vacíos.
 * Devuelve null si el campo no es un número utilizable.
 */
export function aNumero(valor: string | undefined, separador = ","): number | null {
  if (valor == null) return null;

  // Con punto y coma como separador de campos, la coma es el decimal
  // (formato es-CO) y el punto es el separador de miles.
  const normalizado =
    separador === ";" ? valor.replace(/\./g, "").replace(",", ".") : valor.replace(/,/g, "");

  const limpio = normalizado.replace(/["\s]/g, "");
  if (limpio === "" || limpio === "-" || limpio.toUpperCase() === "N/A") return null;
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Normaliza la fecha de una celda a ISO.
 *
 * Acepta ISO y los formatos con barras o guiones de los exportes.
 *
 * `11/09/2026` es ambiguo y leerlo mal corrompe la serie en silencio, así
 * que se resuelve con dos señales, en este orden:
 *   1. Si el primer componente supera 12, solo puede ser el día.
 *   2. Si no, manda `diaPrimero`: el importador lo activa cuando el
 *      archivo usa punto y coma, porque Excel solo escribe ese separador
 *      en configuraciones regionales que además formatean dd/mm/aaaa.
 * Por defecto se asume mm/dd/aaaa, que es lo que exporta Barchart.
 */
export function aFechaIsoFlexible(valor: string, diaPrimero = false): string | null {
  const limpio = valor.replace(/"/g, "").trim();
  if (!limpio) return null;

  const soloFecha = limpio.split(/[ T]/)[0];
  if (esFechaIso(soloFecha)) return soloFecha;

  const partes = soloFecha.split(/[/\-.]/);
  if (partes.length !== 3) return null;

  const [primero, segundo] = partes;
  let [, , anio] = partes;

  // Formato aaaa/mm/dd.
  if (primero.length === 4) {
    const iso = `${primero}-${segundo.padStart(2, "0")}-${anio.padStart(2, "0")}`;
    return esFechaIso(iso) ? iso : null;
  }

  if (anio.length === 2) anio = Number(anio) > 70 ? `19${anio}` : `20${anio}`;

  const primeroNum = Number(primero);
  const ambiguo = primeroNum <= 12;
  const [mes, dia] =
    !ambiguo || diaPrimero ? [segundo, primero] : [primero, segundo];

  const iso = `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  return esFechaIso(iso) ? iso : null;
}

function localizarColumnas(encabezado: string[]): Record<string, number> {
  const indices: Record<string, number> = {};

  encabezado.forEach((celda, i) => {
    const normalizada = normalizar(celda);
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (indices[campo] === undefined && alias.includes(normalizada)) {
        indices[campo] = i;
      }
    }
  });

  return indices;
}

/**
 * Extrae el símbolo del nombre del archivo descargado.
 *
 * El export de barchart.com no incluye columna `Symbol`, pero bautiza el
 * archivo con el contrato: `ccz26_price-history-09-11-2026.csv`. Sin esto
 * el usuario tendría que teclear el símbolo a mano en cada carga y un
 * despiste mezclaría dos vencimientos bajo el mismo nombre.
 *
 * Solo acepta la forma de un contrato de futuros —raíz, código de mes y
 * año— para no bautizar una serie con cualquier nombre de archivo.
 */
export function simboloDesdeNombreArchivo(nombre: string): string | null {
  const base = nombre.replace(/\.[^.]+$/, "");
  const primero = base.split(/[^A-Za-z0-9]/)[0] ?? "";

  // Códigos de mes de los futuros: F G H J K M N Q U V X Z.
  return /^[A-Za-z]{1,3}[FGHJKMNQUVXZ]\d{2}$/i.test(primero)
    ? primero.toUpperCase()
    : null;
}

export interface ResultadoImportacion extends SerieHistorica {
  /** Filas ignoradas por no ser datos (pie de página, celdas corruptas). */
  filasDescartadas: number;
}

/**
 * Interpreta un CSV de Barchart y devuelve una serie normalizada.
 *
 * @param contenido Texto completo del archivo.
 * @param simbolo   Símbolo a asignar si el CSV no trae columna propia.
 * @param serie     "CC" para cacao, "TRM" para la tasa de cambio.
 */
export function importarCsv(
  contenido: string,
  simbolo = "CC",
  serie: TipoSerie = "CC",
): ResultadoImportacion {
  const lineas = contenido
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const separador = detectarSeparador(contenido);

  if (lineas.length < 2) {
    throw new ErrorDatos(NOMBRE, "respuesta_invalida", "El archivo CSV está vacío o no tiene datos.");
  }

  // El encabezado no siempre es la primera línea: algunos exportes
  // anteponen el nombre del contrato o una línea de título.
  let indiceEncabezado = -1;
  let columnas: Record<string, number> = {};

  for (let i = 0; i < Math.min(lineas.length, 10); i++) {
    const candidatas = localizarColumnas(dividirLineaCsv(lineas[i], separador));
    if (candidatas.fecha !== undefined && candidatas.cierre !== undefined) {
      indiceEncabezado = i;
      columnas = candidatas;
      break;
    }
  }

  if (indiceEncabezado === -1) {
    throw new ErrorDatos(
      NOMBRE,
      "respuesta_invalida",
      "No se encontró un encabezado con columnas de fecha y cierre. Exporte el histórico desde barchart.com incluyendo al menos Date y Close.",
    );
  }

  const barras: Barra[] = [];
  let filasDescartadas = 0;
  let simboloDetectado: string | null = null;

  for (let i = indiceEncabezado + 1; i < lineas.length; i++) {
    const celdas = dividirLineaCsv(lineas[i], separador);

    const fecha = aFechaIsoFlexible(celdas[columnas.fecha] ?? "", separador === ";");
    const cierre = aNumero(celdas[columnas.cierre], separador);

    // Las líneas de pie ("Downloaded from Barchart.com as of ...") caen aquí.
    if (!fecha || cierre == null) {
      filasDescartadas++;
      continue;
    }

    if (simboloDetectado === null && columnas.simbolo !== undefined) {
      const valor = (celdas[columnas.simbolo] ?? "").replace(/"/g, "").trim();
      if (valor) simboloDetectado = valor;
    }

    barras.push({
      fecha,
      apertura: columnas.apertura !== undefined ? aNumero(celdas[columnas.apertura], separador) : null,
      maximo: columnas.maximo !== undefined ? aNumero(celdas[columnas.maximo], separador) : null,
      minimo: columnas.minimo !== undefined ? aNumero(celdas[columnas.minimo], separador) : null,
      cierre,
      volumen: columnas.volumen !== undefined ? aNumero(celdas[columnas.volumen], separador) : null,
    });
  }

  if (barras.length === 0) {
    throw new ErrorDatos(
      NOMBRE,
      "sin_datos",
      "El CSV no contiene ninguna fila con fecha y cierre válidos.",
    );
  }

  // Barchart exporta de más reciente a más antiguo; el motor espera lo contrario.
  barras.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Una descarga puede traer la misma fecha repetida: gana la última leída.
  const porFecha = new Map<string, Barra>();
  for (const barra of barras) porFecha.set(barra.fecha, barra);

  return {
    serie,
    simbolo: simboloDetectado ?? simbolo,
    fuente: "barchart_csv",
    barras: [...porFecha.values()],
    filasDescartadas,
  };
}
