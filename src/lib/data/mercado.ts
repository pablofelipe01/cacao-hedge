/**
 * Orquestador de la capa de datos.
 *
 * Convierte "quiero analizar un lote" en el objeto `Mercado` que consume
 * el motor: precio del futuro, TRM y las dos volatilidades históricas,
 * más la trazabilidad de dónde salió cada número.
 *
 * No lleva el guardia `server-only` a propósito: no toca secretos, recibe
 * los clientes de Supabase ya construidos como parámetros. El módulo que
 * sí custodia la service role key es `lib/supabase/admin.ts`, y ese sí lo
 * lleva. Sin el guardia, este orquestador se puede testear.
 */

import { SIMBOLO_TRM } from "@/lib/engine/constantes";
import type { Mercado } from "@/lib/engine/tipos";
import { volatilidadHistorica } from "@/lib/engine/volatilidad";
import type { FuentePrecio } from "@/types/database";

import { obtenerSerieConCache, type OpcionesConCache } from "./cache";
import { ErrorDatos } from "./errores";
import { aFechaIso, restarDias } from "./fechas";
import { trmHistorica, trmVigente, type OpcionesTrm } from "./trm";
import type { PriceProvider } from "./tipos";
import { YahooProvider } from "./yahoo";
import { BarchartProvider } from "./barchart";

/**
 * Ventana histórica para estimar volatilidad.
 *
 * Un año de datos: suficiente para que la estimación sea estable y
 * reciente como para reflejar el régimen actual del cacao, que cambió
 * mucho entre 2023 y 2025.
 */
export const DIAS_HISTORICO = 365;

/** Volatilidad de respaldo del cacao si la serie no alcanza. */
export const VOL_CACAO_RESPALDO = 0.35;

/** Volatilidad de respaldo del peso colombiano. */
export const VOL_TRM_RESPALDO = 0.12;

export interface ProcedenciaSerie {
  fuente: FuentePrecio;
  simbolo: string;
  barras: number;
  desdeCache: boolean;
  ultimaFecha: string;
  /** true si se usó la volatilidad de respaldo por serie insuficiente. */
  volatilidadDeRespaldo: boolean;
}

export interface MercadoConProcedencia {
  mercado: Mercado;
  procedencia: { cacao: ProcedenciaSerie; trm: ProcedenciaSerie };
  /** Avisos no bloqueantes sobre la calidad de los datos. */
  advertencias: string[];
}

/**
 * Serie de cacao concreta a usar, cuando no es la del proveedor en vivo.
 *
 * Sirve para analizar contra un vencimiento importado por CSV (`CCZ26`,
 * `barchart_csv`) en vez del continuo de Yahoo. Sin esto, importar un
 * histórico sería decorativo: el análisis seguiría consultando `CC=F`.
 */
export interface OrigenCacao {
  simbolo: string;
  fuente: FuentePrecio;
}

export interface OpcionesMercado {
  cliente: OpcionesConCache["cliente"];
  clienteAdmin?: OpcionesConCache["clienteAdmin"];
  /** Proveedor de cacao. Por defecto se elige el mejor disponible. */
  proveedor?: PriceProvider;
  /** Serie de cacao a usar. Por defecto, la del proveedor en vivo. */
  origenCacao?: OrigenCacao;
  /** Fecha de referencia, ISO. Por defecto, hoy. Inyectable para tests. */
  hoy?: string;
  opcionesTrm?: OpcionesTrm;
}

/**
 * Elige el proveedor de precios de cacao.
 *
 * Barchart primero si tiene API key: es dato de mercado real y con el
 * vencimiento exacto. Yahoo es el respaldo que hace funcionar el sistema
 * completo sin suscripción.
 */
export function elegirProveedor(barchartApiKey: string): PriceProvider {
  const barchart = new BarchartProvider(barchartApiKey);
  return barchart.disponible() ? barchart : new YahooProvider();
}

/**
 * Arma el `Mercado` que consume el motor de cálculo.
 *
 * Las dos series se traen en paralelo: son independientes y así el
 * análisis no espera dos redondeos de red en serie.
 */
export async function obtenerMercado(
  opciones: OpcionesMercado,
): Promise<MercadoConProcedencia> {
  const {
    cliente,
    clienteAdmin,
    proveedor = new YahooProvider(),
    origenCacao,
    hoy = aFechaIso(new Date()),
    opcionesTrm = {},
  } = opciones;

  const desde = restarDias(hoy, DIAS_HISTORICO);
  const advertencias: string[] = [];

  const simboloVivo = proveedor.fuente === "barchart_api" ? "CC*1" : "CC=F";
  const simbolo = origenCacao?.simbolo ?? simboloVivo;
  const fuente = origenCacao?.fuente ?? proveedor.fuente;

  // Una serie importada no se puede refrescar por red: si la caché no
  // alcanza, hay que decirlo con claridad en vez de intentar pedirle a
  // Yahoo un símbolo que no conoce.
  const importada = fuente === "barchart_csv" || fuente === "manual";
  const traerCacao = importada
    ? async (): Promise<never> => {
        throw new ErrorDatos(
          "Histórico importado",
          "sin_datos",
          `La serie ${simbolo} viene de un archivo importado y no tiene datos suficientes o recientes para el análisis. Vuelva a importarla desde /importar con un rango más amplio.`,
        );
      }
    : () => proveedor.historico({ simbolo, desde, hasta: hoy });

  const [serieCacao, serieTrm] = await Promise.all([
    obtenerSerieConCache({
      cliente,
      clienteAdmin,
      serie: "CC",
      simbolo,
      fuente,
      desde,
      hasta: hoy,
      traerDeFuente: traerCacao,
    }),
    obtenerSerieConCache({
      cliente,
      clienteAdmin,
      serie: "TRM",
      simbolo: SIMBOLO_TRM,
      fuente: "datos_gov_co",
      desde,
      hasta: hoy,
      traerDeFuente: () => trmHistorica({ desde, hasta: hoy }, opcionesTrm),
    }),
  ]);

  const ultimaCacao = serieCacao.barras.at(-1);
  const ultimaTrm = serieTrm.barras.at(-1);

  if (!ultimaCacao || !ultimaTrm) {
    throw new ErrorDatos(
      "Datos de mercado",
      "sin_datos",
      "No hay suficientes datos de cacao o de TRM para construir el análisis.",
    );
  }

  const volCacao = volatilidadHistorica(
    serieCacao.barras.map((b) => b.cierre),
    VOL_CACAO_RESPALDO,
  );
  const volTrm = volatilidadHistorica(
    serieTrm.barras.map((b) => b.cierre),
    VOL_TRM_RESPALDO,
  );

  if (volCacao.usoRespaldo) {
    advertencias.push(
      `La serie de cacao tiene solo ${volCacao.observaciones} retornos utilizables: se usó la volatilidad de respaldo del ${(VOL_CACAO_RESPALDO * 100).toFixed(0)} %.`,
    );
  }
  if (volTrm.usoRespaldo) {
    advertencias.push(
      `La serie de TRM tiene solo ${volTrm.observaciones} retornos utilizables: se usó la volatilidad de respaldo del ${(VOL_TRM_RESPALDO * 100).toFixed(0)} %.`,
    );
  }
  if (serieCacao.desdeCache) {
    advertencias.push(
      `El precio del cacao proviene de la caché (última barra del ${ultimaCacao.fecha}), no de una consulta en vivo.`,
    );
  }
  if (serieCacao.fuente === "yahoo") {
    advertencias.push(
      "La fuente es el continuo CC=F de Yahoo: precio orientativo y posiblemente diferido, no apto para liquidar operaciones.",
    );
  }

  // Un contrato sin volumen el último día está expirado o es ilíquido:
  // su precio dejó de reflejar el mercado y arrastra todo el análisis.
  if (ultimaCacao.volumen === 0) {
    advertencias.push(
      `El contrato ${simbolo} no registró volumen el ${ultimaCacao.fecha}: probablemente esté vencido o sea ilíquido. Verifique que sea el vencimiento correcto para su embarque.`,
    );
  }

  const mercado: Mercado = {
    futuroUsdTm: ultimaCacao.cierre,
    trm: ultimaTrm.cierre,
    volAnualizada: volCacao.anualizada,
    volTrmAnualizada: volTrm.anualizada,
    fechaDatos: ultimaCacao.fecha,
  };

  return {
    mercado,
    procedencia: {
      cacao: {
        fuente: serieCacao.fuente,
        simbolo: serieCacao.simbolo,
        barras: serieCacao.barras.length,
        desdeCache: serieCacao.desdeCache,
        ultimaFecha: ultimaCacao.fecha,
        volatilidadDeRespaldo: volCacao.usoRespaldo,
      },
      trm: {
        fuente: serieTrm.fuente,
        simbolo: serieTrm.simbolo,
        barras: serieTrm.barras.length,
        desdeCache: serieTrm.desdeCache,
        ultimaFecha: ultimaTrm.fecha,
        volatilidadDeRespaldo: volTrm.usoRespaldo,
      },
    },
    advertencias,
  };
}

export { trmVigente };
