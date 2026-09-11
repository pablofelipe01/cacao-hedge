"use server";

import { revalidatePath } from "next/cache";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { ErrorInforme, generarInforme } from "@/lib/anthropic/informe";
import { construirResumen } from "@/lib/anthropic/resumen";
import type { EvaluacionEstrategia, Recomendacion } from "@/lib/engine/index";
import type { Lote, Mercado, Supuestos, TipoOperacion } from "@/lib/engine/tipos";
import type { Json } from "@/types/database";

export type EstadoInforme = { error?: string; generado?: boolean };

/**
 * Genera el informe narrativo de un análisis ya calculado y lo persiste.
 *
 * Se reconstruye el resumen desde lo que está guardado, no desde un nuevo
 * cálculo: el informe debe describir exactamente el análisis que el
 * usuario tiene en pantalla, aunque el mercado se haya movido desde que
 * se corrió.
 */
export async function generarInformeNarrativo(
  _estado: EstadoInforme,
  formData: FormData,
): Promise<EstadoInforme> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { error: "Debe iniciar sesión." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Falta el identificador del análisis." };

  const supabase = await crearClienteServidor();
  const { data: analisis, error } = await supabase
    .from("analisis")
    .select("id, entradas, mercado, supuestos, resultados")
    .eq("id", id)
    .maybeSingle();

  if (error || !analisis?.resultados) {
    return { error: "No se encontró el análisis." };
  }

  const entradas = analisis.entradas as unknown as {
    toneladas: number;
    costoCopKg: number;
    diasAEmbarque: number;
    diferencialUsdTm: number;
    tipoContrato: Lote["tipoContrato"];
    precioVentaUsdTm?: string;
    fechaEmbarque: string;
    situacion?: "tengo_cacao" | "ya_vendi";
  };
  const mercado = analisis.mercado as unknown as Mercado & {
    procedencia?: { cacao: { fuente: string; simbolo: string; barras: number } };
  };
  const resultados = analisis.resultados as unknown as {
    evaluaciones: EvaluacionEstrategia[];
    recomendacion: Recomendacion;
    precioEquilibrioUsdTm: number;
    dimensionamiento: {
      contratosExactos: number;
      subcobertura: { contratos: number; toneladasResiduales: number };
      sobrecobertura: { contratos: number; toneladasResiduales: number };
    };
    advertencias: string[];
    advertenciasDatos?: string[];
    operacion?: TipoOperacion;
  };

  // Los análisis guardados antes del caso A no traen `operacion`: todos
  // eran de inventario, así que ese es el valor que corresponde.
  const tipoOperacion: TipoOperacion =
    resultados.operacion ??
    (entradas.situacion === "ya_vendi" ? "venta_sin_comprar" : "inventario_sin_vender");

  const precio = Number(String(entradas.precioVentaUsdTm ?? "").replace(",", "."));
  const lote: Lote = {
    toneladas: entradas.toneladas,
    costoCopKg: tipoOperacion === "venta_sin_comprar" ? 0 : entradas.costoCopKg,
    diasAEmbarque: entradas.diasAEmbarque,
    diferencialUsdTm: entradas.diferencialUsdTm,
    tipoOperacion,
    tipoContrato: entradas.tipoContrato,
    precioVentaUsdTm: Number.isFinite(precio) ? precio : null,
  };

  const resumen = construirResumen({
    lote,
    fechaEmbarque: entradas.fechaEmbarque,
    mercado,
    supuestos: analisis.supuestos as unknown as Supuestos,
    evaluaciones: resultados.evaluaciones,
    recomendacion: resultados.recomendacion,
    precioEquilibrioUsdTm: resultados.precioEquilibrioUsdTm,
    dimensionamiento: resultados.dimensionamiento,
    procedencia: mercado.procedencia?.cacao ?? {
      fuente: "desconocida",
      simbolo: "CC",
      barras: 0,
    },
    advertencias: [...resultados.advertencias, ...(resultados.advertenciasDatos ?? [])],
  });

  try {
    const informe = await generarInforme(resumen);

    const { error: errorGuardado } = await supabase
      .from("analisis")
      .update({
        estado: "con_informe",
        informe_md: informe.markdown,
        informe_meta: informe.meta as unknown as Json,
      })
      .eq("id", id);

    if (errorGuardado) {
      return { error: `El informe se generó pero no se pudo guardar: ${errorGuardado.message}` };
    }

    revalidatePath(`/analisis/${id}`);
    return { generado: true };
  } catch (error) {
    if (error instanceof ErrorInforme) return { error: error.mensajeUsuario };
    return { error: "No se pudo generar el informe narrativo." };
  }
}
