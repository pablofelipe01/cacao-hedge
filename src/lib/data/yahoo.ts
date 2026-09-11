/**
 * YahooProvider: respaldo gratuito con el continuo `CC=F`.
 *
 * Es la fuente que hace que el sistema funcione completo sin ninguna
 * suscripción. Tres límites verificados en la práctica:
 *
 *  1. `CC=F` es el contrato frontal continuo, no un vencimiento concreto,
 *     y sus precios pueden venir diferidos. Sirve para dimensionar
 *     riesgo, no para liquidar una operación.
 *  2. Yahoo limita las peticiones por IP de forma agresiva y devuelve 429
 *     con facilidad: unas pocas consultas seguidas bastan para agotar la
 *     ventana, y entonces rechaza incluso los rangos cortos. Por eso este
 *     proveedor reintenta con esperas largas, no con las del cliente HTTP
 *     genérico.
 *  3. La defensa de verdad contra ese 429 es la caché de `precios`: una
 *     vez sembrada la serie, el refresco diario es marginal y un rechazo
 *     puntual de Yahoo deja de tumbar el análisis. El respaldo manual es
 *     la importación de CSV.
 */

import { SIMBOLO_CONTINUO_YAHOO } from "@/lib/engine/constantes";
import { ErrorDatos } from "./errores";
import { diaDeNegociacion, diasEntre } from "./fechas";
import { obtenerJson, type OpcionesPeticion } from "./http";
import type {
  Barra,
  Cotizacion,
  OpcionesHistorico,
  PriceProvider,
  SerieHistorica,
} from "./tipos";

const NOMBRE = "Yahoo Finance";
const BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

/** Yahoo rechaza las peticiones sin user-agent de navegador. */
const CABECERAS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

/** Forma de la respuesta de `/v8/finance/chart`, recortada a lo que se usa. */
interface RespuestaChart {
  chart: {
    result:
      | {
          meta: {
            currency?: string;
            symbol?: string;
            shortName?: string;
            gmtoffset?: number;
            regularMarketPrice?: number;
            regularMarketTime?: number;
          };
          timestamp?: number[];
          indicators: {
            quote: {
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
              volume?: (number | null)[];
            }[];
          };
        }[]
      | null;
    error: { code?: string; description?: string } | null;
  };
}

/** Rango que cubre los días pedidos, entre los que acepta la API de Yahoo. */
export function rangoParaDias(dias: number): string {
  if (dias <= 5) return "5d";
  if (dias <= 30) return "1mo";
  if (dias <= 90) return "3mo";
  if (dias <= 180) return "6mo";
  if (dias <= 365) return "1y";
  if (dias <= 730) return "2y";
  if (dias <= 1825) return "5y";
  return "10y";
}

/**
 * Convierte la respuesta de Yahoo en barras normalizadas.
 *
 * Yahoo devuelve arreglos paralelos con huecos: los días sin negociación
 * traen `null`. Una barra sin cierre no es dato, se descarta.
 */
export function normalizarChart(datos: RespuestaChart): {
  barras: Barra[];
  meta: NonNullable<RespuestaChart["chart"]["result"]>[number]["meta"];
} {
  if (datos.chart?.error) {
    throw new ErrorDatos(
      NOMBRE,
      "respuesta_invalida",
      `Yahoo rechazó la consulta: ${datos.chart.error.description ?? datos.chart.error.code ?? "sin detalle"}.`,
    );
  }

  const resultado = datos.chart?.result?.[0];
  if (!resultado) {
    throw new ErrorDatos(NOMBRE, "sin_datos", "Yahoo no devolvió resultados para el símbolo.");
  }

  const marcas = resultado.timestamp ?? [];
  const cotizaciones = resultado.indicators?.quote?.[0] ?? {};
  const desplazamiento = resultado.meta?.gmtoffset ?? 0;

  const barras: Barra[] = [];
  for (let i = 0; i < marcas.length; i++) {
    const cierre = cotizaciones.close?.[i];
    if (cierre == null || !Number.isFinite(cierre)) continue;

    barras.push({
      fecha: diaDeNegociacion(marcas[i], desplazamiento),
      apertura: cotizaciones.open?.[i] ?? null,
      maximo: cotizaciones.high?.[i] ?? null,
      minimo: cotizaciones.low?.[i] ?? null,
      cierre,
      volumen: cotizaciones.volume?.[i] ?? null,
    });
  }

  return { barras, meta: resultado.meta ?? {} };
}

/**
 * Reintentos pensados para el límite de Yahoo: pocas peticiones, muy
 * espaciadas. Con la espera por defecto de 500 ms el reintento cae dentro
 * de la misma ventana sancionada y solo sirve para gastar cuota.
 */
const REINTENTOS_YAHOO = { intentos: 4, esperaBaseMs: 4000 } as const;

export class YahooProvider implements PriceProvider {
  readonly nombre = NOMBRE;
  readonly fuente = "yahoo" as const;

  constructor(private readonly opcionesHttp: Partial<OpcionesPeticion> = {}) {}

  /** El respaldo gratuito no necesita credenciales: siempre disponible. */
  disponible(): boolean {
    return true;
  }

  private peticion(): OpcionesPeticion {
    return {
      proveedor: NOMBRE,
      cabeceras: CABECERAS,
      ...REINTENTOS_YAHOO,
      ...this.opcionesHttp,
    };
  }

  async cotizacion(simbolo = SIMBOLO_CONTINUO_YAHOO): Promise<Cotizacion> {
    const url = `${BASE}/${encodeURIComponent(simbolo)}?range=5d&interval=1d`;
    const datos = await obtenerJson<RespuestaChart>(url, this.peticion());
    const { barras, meta } = normalizarChart(datos);

    const ultima = barras.at(-1);
    // `regularMarketPrice` es más fresco que el cierre de la última barra.
    const precio = meta.regularMarketPrice ?? ultima?.cierre;

    if (precio == null || !Number.isFinite(precio)) {
      throw new ErrorDatos(NOMBRE, "sin_datos", `Yahoo no tiene precio vigente para ${simbolo}.`);
    }

    return {
      serie: "CC",
      simbolo,
      fuente: this.fuente,
      precio,
      fecha:
        meta.regularMarketTime != null
          ? diaDeNegociacion(meta.regularMarketTime, meta.gmtoffset ?? 0)
          : (ultima?.fecha ?? new Date().toISOString().slice(0, 10)),
      descripcion: meta.shortName,
      moneda: meta.currency,
    };
  }

  async historico({
    simbolo = SIMBOLO_CONTINUO_YAHOO,
    desde,
    hasta,
  }: OpcionesHistorico): Promise<SerieHistorica> {
    const fin = hasta ?? new Date().toISOString().slice(0, 10);
    const rango = rangoParaDias(Math.max(diasEntre(desde, fin), 1));

    const url = `${BASE}/${encodeURIComponent(simbolo)}?range=${rango}&interval=1d`;
    const datos = await obtenerJson<RespuestaChart>(url, this.peticion());
    const { barras } = normalizarChart(datos);

    // Yahoo solo acepta rangos predefinidos: el recorte fino se hace aquí.
    const enRango = barras.filter((b) => b.fecha >= desde && b.fecha <= fin);

    if (enRango.length === 0) {
      throw new ErrorDatos(
        NOMBRE,
        "sin_datos",
        `Yahoo no devolvió barras de ${simbolo} entre ${desde} y ${fin}.`,
      );
    }

    return { serie: "CC", simbolo, fuente: this.fuente, barras: enRango };
  }
}
