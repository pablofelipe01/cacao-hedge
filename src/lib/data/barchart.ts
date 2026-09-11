/**
 * BarchartProvider: cliente de la API OnDemand de Barchart.
 *
 * IMPORTANTE — comprobado antes de escribir esto: una cuenta estándar de
 * barchart.com NO incluye acceso a la API OnDemand. Es un producto aparte
 * que se contrata por separado, con su propia API key. El cliente queda
 * implementado y listo; mientras `BARCHART_API_KEY` esté vacía el
 * proveedor se reporta como no disponible y el orquestador usa Yahoo o el
 * CSV importado, sin que nada falle.
 *
 * Lo que sí permite la cuenta estándar es descargar históricos en CSV
 * desde la web: para eso está `csv.ts`.
 *
 * Endpoints: `getQuote.json` y `getHistory.json`.
 * Símbolos: el continuo frontal del cacao es `CC*1`; un vencimiento
 * concreto se nombra `CCZ26` (diciembre 2026).
 */

import { ErrorDatos } from "./errores";
import { obtenerJson, type OpcionesPeticion } from "./http";
import type {
  Barra,
  Cotizacion,
  OpcionesHistorico,
  PriceProvider,
  SerieHistorica,
} from "./tipos";

const NOMBRE = "Barchart OnDemand";
const BASE = "https://ondemand.websol.barchart.com";

/** Continuo frontal del cacao en la nomenclatura de Barchart. */
export const SIMBOLO_CONTINUO_BARCHART = "CC*1";

interface RespuestaBarchart<T> {
  status: { code: number; message?: string };
  results: T[] | null;
}

interface CotizacionBarchart {
  symbol: string;
  name?: string;
  lastPrice?: number;
  close?: number;
  tradeTimestamp?: string;
  serverTimestamp?: string;
  unitCode?: string;
}

interface BarraBarchart {
  symbol: string;
  tradingDay?: string;
  timestamp?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

/** Barchart usa `yyyymmdd` sin separadores en los parámetros de fecha. */
export function aFechaBarchart(fechaIso: string): string {
  return fechaIso.replaceAll("-", "");
}

/**
 * Valida el sobre de respuesta de Barchart.
 *
 * La API responde 200 incluso cuando falla: el código real viene en
 * `status.code`, así que hay que mirarlo siempre.
 */
export function validarSobre<T>(respuesta: RespuestaBarchart<T>): T[] {
  const codigo = respuesta?.status?.code;

  if (codigo === 401 || codigo === 403) {
    throw new ErrorDatos(NOMBRE, "no_autorizado", "Barchart rechazó la API key.", {
      estadoHttp: codigo,
    });
  }
  if (codigo === 429) {
    throw new ErrorDatos(NOMBRE, "limite_peticiones", "Barchart agotó la cuota de consultas.", {
      estadoHttp: codigo,
    });
  }
  if (codigo !== 200) {
    throw new ErrorDatos(
      NOMBRE,
      "respuesta_invalida",
      `Barchart devolvió el código ${codigo}: ${respuesta?.status?.message ?? "sin detalle"}.`,
      { estadoHttp: codigo },
    );
  }

  if (!respuesta.results || respuesta.results.length === 0) {
    throw new ErrorDatos(NOMBRE, "sin_datos", "Barchart no devolvió resultados.");
  }

  return respuesta.results;
}

/** Convierte barras de Barchart al formato normalizado. */
export function normalizarBarras(crudas: BarraBarchart[]): Barra[] {
  const barras: Barra[] = [];

  for (const cruda of crudas) {
    const fecha = (cruda.tradingDay ?? cruda.timestamp ?? "").slice(0, 10);
    if (!fecha || cruda.close == null || !Number.isFinite(cruda.close)) continue;

    barras.push({
      fecha,
      apertura: cruda.open ?? null,
      maximo: cruda.high ?? null,
      minimo: cruda.low ?? null,
      cierre: cruda.close,
      volumen: cruda.volume ?? null,
    });
  }

  return barras.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export class BarchartProvider implements PriceProvider {
  readonly nombre = NOMBRE;
  readonly fuente = "barchart_api" as const;

  constructor(
    private readonly apiKey: string,
    private readonly opcionesHttp: Partial<OpcionesPeticion> = {},
  ) {}

  disponible(): boolean {
    return this.apiKey.trim().length > 0;
  }

  motivoNoDisponible(): string {
    return "Falta BARCHART_API_KEY. La API OnDemand es un producto aparte de la cuenta estándar de barchart.com; mientras tanto se usa Yahoo (CC=F) o la importación de CSV.";
  }

  private exigirCredenciales(): void {
    if (!this.disponible()) {
      throw new ErrorDatos(NOMBRE, "sin_credenciales", this.motivoNoDisponible());
    }
  }

  private peticion(): OpcionesPeticion {
    return { proveedor: NOMBRE, ...this.opcionesHttp };
  }

  async cotizacion(simbolo = SIMBOLO_CONTINUO_BARCHART): Promise<Cotizacion> {
    this.exigirCredenciales();

    const url = `${BASE}/getQuote.json?apikey=${encodeURIComponent(this.apiKey)}&symbols=${encodeURIComponent(simbolo)}`;
    const respuesta = await obtenerJson<RespuestaBarchart<CotizacionBarchart>>(
      url,
      this.peticion(),
    );
    const [cotizacion] = validarSobre(respuesta);

    const precio = cotizacion.lastPrice ?? cotizacion.close;
    if (precio == null || !Number.isFinite(precio)) {
      throw new ErrorDatos(NOMBRE, "sin_datos", `Barchart no tiene precio vigente para ${simbolo}.`);
    }

    return {
      serie: "CC",
      simbolo: cotizacion.symbol ?? simbolo,
      fuente: this.fuente,
      precio,
      fecha: (cotizacion.tradeTimestamp ?? cotizacion.serverTimestamp ?? "").slice(0, 10),
      descripcion: cotizacion.name,
      moneda: "USD",
    };
  }

  async historico({
    simbolo = SIMBOLO_CONTINUO_BARCHART,
    desde,
    hasta,
  }: OpcionesHistorico): Promise<SerieHistorica> {
    this.exigirCredenciales();

    const parametros = new URLSearchParams({
      apikey: this.apiKey,
      symbol: simbolo,
      type: "daily",
      startDate: aFechaBarchart(desde),
      order: "asc",
    });
    if (hasta) parametros.set("endDate", aFechaBarchart(hasta));

    const respuesta = await obtenerJson<RespuestaBarchart<BarraBarchart>>(
      `${BASE}/getHistory.json?${parametros}`,
      this.peticion(),
    );

    const barras = normalizarBarras(validarSobre(respuesta));
    if (barras.length === 0) {
      throw new ErrorDatos(NOMBRE, "sin_datos", `Barchart no devolvió barras de ${simbolo}.`);
    }

    return { serie: "CC", simbolo, fuente: this.fuente, barras };
  }
}
