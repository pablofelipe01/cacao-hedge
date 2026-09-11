/**
 * Cliente HTTP con reintentos, pensado para APIs de mercado que fallan de
 * forma intermitente.
 *
 * Reintenta solo lo que tiene sentido reintentar: errores de red, tiempos
 * agotados, 429 y 5xx. Un 401 o un 404 no mejoran por insistir, así que
 * fallan de inmediato con un mensaje claro.
 */

import { ErrorDatos } from "./errores";

export interface OpcionesPeticion {
  /** Nombre del proveedor, para los mensajes de error. */
  proveedor: string;
  /** Intentos totales, incluido el primero. */
  intentos?: number;
  /** Espera base entre reintentos, en ms. Crece exponencialmente. */
  esperaBaseMs?: number;
  /** Tiempo máximo por intento, en ms. */
  tiempoMaximoMs?: number;
  cabeceras?: Record<string, string>;
  /** Inyectables para poder testear sin red ni esperas reales. */
  fetchImpl?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  /** Fuente de aleatoriedad del jitter; inyectable para tests. */
  aleatorio?: () => number;
}

const INTENTOS_POR_DEFECTO = 3;
const ESPERA_BASE_MS = 500;
const TIEMPO_MAXIMO_MS = 15_000;

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Traduce un código HTTP a una causa de error del dominio. */
export function causaDesdeEstado(estado: number) {
  if (estado === 401 || estado === 403) return "no_autorizado" as const;
  if (estado === 429) return "limite_peticiones" as const;
  if (estado >= 500) return "servidor_externo" as const;
  return "respuesta_invalida" as const;
}

/**
 * Espera antes del siguiente intento: retroceso exponencial con jitter.
 *
 * El jitter evita que varias peticiones que fallaron a la vez vuelvan a
 * golpear la API sincronizadas.
 */
export function calcularEspera(
  intento: number,
  esperaBaseMs: number,
  aleatorio: () => number,
): number {
  const exponencial = esperaBaseMs * 2 ** intento;
  return Math.round(exponencial * (0.5 + aleatorio() * 0.5));
}

/**
 * Respeta la cabecera `Retry-After` cuando el servidor la envía; es más
 * fiable que cualquier heurística propia.
 */
export function esperaSugeridaPorServidor(respuesta: Response): number | null {
  const cabecera = respuesta.headers?.get?.("retry-after");
  if (!cabecera) return null;

  const segundos = Number(cabecera);
  if (Number.isFinite(segundos) && segundos >= 0) return segundos * 1000;

  const fecha = Date.parse(cabecera);
  if (Number.isFinite(fecha)) return Math.max(0, fecha - Date.now());

  return null;
}

/** GET con reintentos que devuelve el cuerpo ya parseado como JSON. */
export async function obtenerJson<T>(url: string, opciones: OpcionesPeticion): Promise<T> {
  const respuesta = await obtenerRespuesta(url, opciones);

  try {
    return (await respuesta.json()) as T;
  } catch (error) {
    throw new ErrorDatos(
      opciones.proveedor,
      "respuesta_invalida",
      `${opciones.proveedor} devolvió un cuerpo que no es JSON válido.`,
      { cause: error },
    );
  }
}

/** GET con reintentos que devuelve el cuerpo como texto (CSV, por ejemplo). */
export async function obtenerTexto(url: string, opciones: OpcionesPeticion): Promise<string> {
  const respuesta = await obtenerRespuesta(url, opciones);
  return respuesta.text();
}

/** GET con reintentos. Devuelve la respuesta cruda ya validada. */
export async function obtenerRespuesta(
  url: string,
  opciones: OpcionesPeticion,
): Promise<Response> {
  const {
    proveedor,
    intentos = INTENTOS_POR_DEFECTO,
    esperaBaseMs = ESPERA_BASE_MS,
    tiempoMaximoMs = TIEMPO_MAXIMO_MS,
    cabeceras,
    fetchImpl = fetch,
    dormir = dormirReal,
    aleatorio = Math.random,
  } = opciones;

  let ultimoError: ErrorDatos | null = null;

  for (let intento = 0; intento < intentos; intento++) {
    try {
      const respuesta = await fetchImpl(url, {
        headers: cabeceras,
        signal: AbortSignal.timeout(tiempoMaximoMs),
      });

      if (respuesta.ok) return respuesta;

      const causa = causaDesdeEstado(respuesta.status);
      ultimoError = new ErrorDatos(
        proveedor,
        causa,
        `${proveedor} respondió ${respuesta.status} ${respuesta.statusText || ""}`.trim(),
        { estadoHttp: respuesta.status },
      );

      if (!ultimoError.reintentable && causa !== "limite_peticiones") throw ultimoError;

      // Un 429 sí se reintenta, preferiblemente con la espera que pide el servidor.
      if (intento < intentos - 1) {
        const sugerida = esperaSugeridaPorServidor(respuesta);
        await dormir(sugerida ?? calcularEspera(intento, esperaBaseMs, aleatorio));
      }
      continue;
    } catch (error) {
      if (error instanceof ErrorDatos) {
        if (!error.reintentable && error.causa !== "limite_peticiones") throw error;
        ultimoError = error;
      } else {
        const agotado =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");

        ultimoError = new ErrorDatos(
          proveedor,
          agotado ? "tiempo_agotado" : "red",
          agotado
            ? `${proveedor} no respondió en ${tiempoMaximoMs} ms.`
            : `No se pudo conectar con ${proveedor}.`,
          { cause: error },
        );
      }

      if (intento < intentos - 1) {
        await dormir(calcularEspera(intento, esperaBaseMs, aleatorio));
      }
    }
  }

  throw (
    ultimoError ??
    new ErrorDatos(proveedor, "red", `Fallo desconocido consultando ${proveedor}.`)
  );
}
