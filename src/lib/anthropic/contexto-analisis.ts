/**
 * Reconstruye, desde la fila guardada, las entradas del motor de un análisis.
 *
 * La usan el chat del analista y el botón «Aplicar este escenario». Los
 * dos tienen que partir exactamente del mismo lote: si cada uno leyera la
 * fila a su manera, el análisis aplicado podría no dar las cifras que el
 * analista acababa de citar.
 */

import type { ContextoAnalisis } from "./analista";
import type { EvaluacionEstrategia, Recomendacion } from "@/lib/engine/index";
import type { DimensionamientoCobertura } from "@/lib/engine/contratos";
import type { Lote, Mercado, Supuestos, TipoOperacion } from "@/lib/engine/tipos";
import type { Json } from "@/types/database";

/** Las entradas tal como las guarda el formulario de análisis. */
export interface EntradasGuardadas {
  toneladas: number;
  costoCopKg: number;
  diasAEmbarque: number;
  /** En modo porcentual guarda el porcentaje (−23,5), no USD/TM. */
  diferencialUsdTm: number;
  tipoContrato: Lote["tipoContrato"];
  precioVentaUsdTm?: string | number | null;
  fechaEmbarque: string;
  situacion?: "tengo_cacao" | "ya_vendi";
  modoDiferencial?: "absoluto" | "porcentual";
  inventarioId?: string;
  origenCacao?: string;
  /** Presente solo en los análisis creados desde un escenario del chat. */
  escenario?: EscenarioAplicado;
}

/** De dónde salió un análisis hipotético. */
export interface EscenarioAplicado {
  descripcion: string;
  origenId: string;
  cambios: Record<string, number>;
}

export interface ResultadosGuardados {
  evaluaciones: EvaluacionEstrategia[];
  recomendacion: Recomendacion;
  precioEquilibrioUsdTm: number;
  dimensionamiento: DimensionamientoCobertura;
  advertencias: string[];
  advertenciasDatos?: string[];
  operacion?: TipoOperacion;
}

export type MercadoGuardado = Mercado & {
  procedencia?: { cacao: { fuente: string; simbolo: string; barras: number } };
};

export interface FilaAnalisis {
  entradas: Json;
  mercado: Json;
  supuestos: Json;
  resultados: Json;
}

export function contextoDesdeFila(fila: FilaAnalisis): {
  contexto: ContextoAnalisis;
  entradas: EntradasGuardadas;
  mercado: MercadoGuardado;
  resultados: ResultadosGuardados;
} {
  const entradas = fila.entradas as unknown as EntradasGuardadas;
  const mercado = fila.mercado as unknown as MercadoGuardado;
  const resultados = fila.resultados as unknown as ResultadosGuardados;

  const tipoOperacion: TipoOperacion =
    resultados.operacion ??
    (entradas.situacion === "ya_vendi" ? "venta_sin_comprar" : "inventario_sin_vender");
  const esPorcentual = entradas.modoDiferencial === "porcentual";
  const precio = Number(String(entradas.precioVentaUsdTm ?? "").replace(",", "."));

  const lote: Lote = {
    toneladas: entradas.toneladas,
    costoCopKg: tipoOperacion === "venta_sin_comprar" ? 0 : entradas.costoCopKg,
    diasAEmbarque: entradas.diasAEmbarque,
    diferencialUsdTm: esPorcentual ? 0 : entradas.diferencialUsdTm,
    diferencialPorcentual: esPorcentual ? entradas.diferencialUsdTm / 100 : null,
    tipoOperacion,
    tipoContrato: entradas.tipoContrato,
    // Como al crearlo: sin precio pactado viaja null. Number("") es 0, no
    // NaN, y sin este cuidado llegaba un cero que el análisis original no tenía.
    precioVentaUsdTm:
      String(entradas.precioVentaUsdTm ?? "").trim() !== "" && Number.isFinite(precio)
        ? precio
        : null,
  };

  const procedencia = mercado.procedencia?.cacao ?? {
    fuente: "desconocida",
    simbolo: "CC",
    barras: 0,
  };

  return {
    contexto: {
      lote,
      mercado,
      supuestos: fila.supuestos as unknown as Supuestos,
      fechaEmbarque: entradas.fechaEmbarque,
      procedencia,
    },
    entradas,
    mercado,
    resultados,
  };
}

/**
 * Límites de lo que se acepta al aplicar un escenario.
 *
 * Los cambios vuelven desde el navegador, así que no se confía en ellos:
 * solo pasan las claves que el recálculo conoce, con valores plausibles.
 * Un análisis hipotético queda marcado como tal en pantalla, pero aun así
 * no debe poder guardarse con cifras absurdas.
 */
const LIMITES: Record<string, [number, number]> = {
  toneladas: [0.001, 100_000],
  diasAEmbarque: [1, 730],
  precioVentaUsdTm: [1, 100_000],
  diferencialUsdTm: [-50_000, 50_000],
  diferencialPorcentaje: [-95, 200],
  futuroUsdTm: [1, 100_000],
  trm: [1, 100_000],
  costoCopKg: [1, 10_000_000],
};

/** Filtra y valida los cambios de un escenario. null si alguno no es válido. */
export function validarCambios(crudo: unknown): Record<string, number> | null {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;

  const salida: Record<string, number> = {};
  for (const [clave, valor] of Object.entries(crudo)) {
    const limite = LIMITES[clave];
    if (!limite) continue;
    if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
    if (valor < limite[0] || valor > limite[1]) return null;
    salida[clave] = valor;
  }
  return salida;
}

/**
 * Las entradas del análisis nuevo, en el mismo formato que guarda el
 * formulario: así la pantalla de resultados, el informe y el chat lo leen
 * sin saber que salió de un escenario.
 */
export function entradasConCambios(
  entradas: EntradasGuardadas,
  cambios: Record<string, number>,
  escenario: EscenarioAplicado,
): EntradasGuardadas {
  const nueva: EntradasGuardadas = { ...entradas, escenario };

  if (cambios.toneladas != null) nueva.toneladas = cambios.toneladas;
  if (cambios.costoCopKg != null) nueva.costoCopKg = cambios.costoCopKg;
  if (cambios.precioVentaUsdTm != null) nueva.precioVentaUsdTm = String(cambios.precioVentaUsdTm);

  // Mismo orden de precedencia que el recálculo: el porcentaje manda.
  if (cambios.diferencialPorcentaje != null) {
    nueva.modoDiferencial = "porcentual";
    nueva.diferencialUsdTm = cambios.diferencialPorcentaje;
  } else if (cambios.diferencialUsdTm != null) {
    nueva.modoDiferencial = "absoluto";
    nueva.diferencialUsdTm = cambios.diferencialUsdTm;
  }

  // La fecha se corre lo mismo que los días, para que las dos sigan
  // diciendo lo mismo en la cabecera del análisis.
  if (cambios.diasAEmbarque != null) {
    const corrimiento = cambios.diasAEmbarque - entradas.diasAEmbarque;
    const fecha = new Date(`${entradas.fechaEmbarque}T00:00:00Z`);
    fecha.setUTCDate(fecha.getUTCDate() + corrimiento);
    nueva.fechaEmbarque = fecha.toISOString().slice(0, 10);
    nueva.diasAEmbarque = cambios.diasAEmbarque;
  }

  return nueva;
}
