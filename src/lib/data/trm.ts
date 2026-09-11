/**
 * TRM oficial de Colombia, desde el portal de datos abiertos.
 *
 * Dataset Socrata `32sa-8pi3` de datos.gov.co. Es la tasa que certifica
 * la Superintendencia Financiera y la que usa la DIAN, así que es la
 * referencia correcta para valorar en pesos una exportación.
 *
 * Particularidad del dataset: cada registro trae `vigenciadesde` y
 * `vigenciahasta`, y un mismo valor puede cubrir varios días (la tasa del
 * viernes rige todo el fin de semana). Se conserva un registro por
 * `vigenciadesde`, que equivale a la serie de días hábiles: es lo correcto
 * para anualizar volatilidad con base 252. Expandir el valor sobre los
 * fines de semana metería retornos cero artificiales y subestimaría el
 * riesgo cambiario.
 */

import { SIMBOLO_TRM } from "@/lib/engine/constantes";
import { ErrorDatos } from "./errores";
import { esFechaIso } from "./fechas";
import { obtenerJson, type OpcionesPeticion } from "./http";
import type { Barra, Cotizacion, OpcionesHistorico, SerieHistorica } from "./tipos";

const NOMBRE = "TRM (datos.gov.co)";
const ENDPOINT_POR_DEFECTO = "https://www.datos.gov.co/resource/32sa-8pi3.json";

/** Registro crudo del dataset Socrata. */
interface RegistroTrm {
  valor?: string | number;
  unidad?: string;
  vigenciadesde?: string;
  vigenciahasta?: string;
}

export interface OpcionesTrm extends Partial<OpcionesPeticion> {
  endpoint?: string;
  /** Token de aplicación de Socrata: opcional, sube el límite de peticiones. */
  appToken?: string;
}

/** Convierte registros de Socrata en barras normalizadas. */
export function normalizarRegistros(registros: RegistroTrm[]): Barra[] {
  const porFecha = new Map<string, Barra>();

  for (const registro of registros) {
    const fecha = (registro.vigenciadesde ?? "").slice(0, 10);
    const valor = Number(registro.valor);

    if (!esFechaIso(fecha) || !Number.isFinite(valor) || valor <= 0) continue;

    // La TRM es un único valor diario: no hay OHLC que reportar.
    porFecha.set(fecha, {
      fecha,
      apertura: null,
      maximo: null,
      minimo: null,
      cierre: valor,
      volumen: null,
    });
  }

  return [...porFecha.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function construirCabeceras(appToken?: string): Record<string, string> {
  const cabeceras: Record<string, string> = { Accept: "application/json" };
  if (appToken) cabeceras["X-App-Token"] = appToken;
  return cabeceras;
}

function peticion(opciones: OpcionesTrm): OpcionesPeticion {
  // `endpoint` y `appToken` no son opciones del cliente HTTP: el primero
  // se usa al construir la URL y el segundo viaja como cabecera.
  const resto = { ...opciones };
  delete resto.endpoint;
  delete resto.appToken;

  return {
    proveedor: NOMBRE,
    cabeceras: construirCabeceras(opciones.appToken),
    ...resto,
  };
}

/**
 * TRM vigente hoy.
 *
 * Se pide el registro más reciente por `vigenciadesde`, no el de la fecha
 * de hoy: en fin de semana o festivo la vigente es la del último día hábil.
 */
export async function trmVigente(opciones: OpcionesTrm = {}): Promise<Cotizacion> {
  const endpoint = opciones.endpoint ?? ENDPOINT_POR_DEFECTO;
  const url = `${endpoint}?$order=vigenciadesde%20DESC&$limit=1`;

  const registros = await obtenerJson<RegistroTrm[]>(url, peticion(opciones));
  const [barra] = normalizarRegistros(registros ?? []);

  if (!barra) {
    throw new ErrorDatos(NOMBRE, "sin_datos", "El portal de datos abiertos no devolvió ninguna TRM.");
  }

  return {
    serie: "TRM",
    simbolo: SIMBOLO_TRM,
    fuente: "datos_gov_co",
    precio: barra.cierre,
    fecha: barra.fecha,
    descripcion: "Tasa Representativa del Mercado",
    moneda: "COP",
  };
}

/** Serie histórica de la TRM entre dos fechas. */
export async function trmHistorica(
  { desde, hasta }: OpcionesHistorico,
  opciones: OpcionesTrm = {},
): Promise<SerieHistorica> {
  const endpoint = opciones.endpoint ?? ENDPOINT_POR_DEFECTO;
  const fin = hasta ?? new Date().toISOString().slice(0, 10);

  const where = `vigenciadesde >= '${desde}T00:00:00' AND vigenciadesde <= '${fin}T23:59:59'`;
  const parametros = new URLSearchParams({
    $where: where,
    $order: "vigenciadesde ASC",
    // El dataset completo ronda los 8.400 registros: este tope cubre
    // cualquier rango sin paginar.
    $limit: "10000",
  });

  const registros = await obtenerJson<RegistroTrm[]>(
    `${endpoint}?${parametros}`,
    peticion(opciones),
  );
  const barras = normalizarRegistros(registros ?? []);

  if (barras.length === 0) {
    throw new ErrorDatos(
      NOMBRE,
      "sin_datos",
      `No hay TRM publicada entre ${desde} y ${fin}.`,
    );
  }

  return { serie: "TRM", simbolo: SIMBOLO_TRM, fuente: "datos_gov_co", barras };
}
