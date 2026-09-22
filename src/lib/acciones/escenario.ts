"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { aplicarCambios } from "@/lib/anthropic/analista";
import {
  contextoDesdeFila,
  entradasConCambios,
  validarCambios,
} from "@/lib/anthropic/contexto-analisis";
import { analizarCobertura } from "@/lib/engine/index";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

function aJson(valor: unknown): Json {
  return JSON.parse(JSON.stringify(valor)) as Json;
}

/**
 * Convierte un escenario que recalculó el analista en un análisis guardado.
 *
 * Los recálculos del chat solo vivían en la conversación: al cerrar la
 * página se perdían. Esto crea un análisis NUEVO y deja el original
 * intacto, porque el original es la fotografía de lo que se decidió con
 * los datos de ese día.
 *
 * Usa el mercado y los supuestos del análisis original, no los de hoy:
 * así el análisis nuevo da exactamente las cifras que el analista citó.
 */
export async function aplicarEscenario(
  analisisId: string,
  descripcion: string,
  cambiosCrudos: unknown,
): Promise<{ error: string }> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const cambios = validarCambios(cambiosCrudos);
  if (!cambios || Object.keys(cambios).length === 0) {
    return { error: "Ese escenario no trae cambios que se puedan aplicar." };
  }

  const supabase = await crearClienteServidor();
  // RLS restringe la fila al dueño: si no aparece, no es suya.
  const { data: fila } = await supabase
    .from("analisis")
    .select("entradas, mercado, supuestos, resultados, inventario_id")
    .eq("id", analisisId)
    .maybeSingle();

  if (!fila?.resultados) return { error: "No se encontró el análisis original." };

  const { contexto, entradas, mercado: mercadoGuardado } = contextoDesdeFila(fila);
  const { lote, mercado } = aplicarCambios(contexto, cambios);

  let resultado;
  try {
    resultado = analizarCobertura(lote, mercado, contexto.supuestos);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "No se pudo calcular ese escenario.",
    };
  }

  const escenario = {
    descripcion: descripcion.trim().slice(0, 300) || "escenario alternativo",
    origenId: analisisId,
    cambios,
  };

  const { data, error } = await supabase
    .from("analisis")
    .insert({
      user_id: usuario.id,
      inventario_id: fila.inventario_id,
      estado: "calculado",
      entradas: aJson(entradasConCambios(entradas, cambios, escenario)),
      mercado: aJson({ ...mercado, procedencia: mercadoGuardado.procedencia }),
      supuestos: aJson(contexto.supuestos),
      resultados: aJson({
        operacion: resultado.operacion,
        aniosHorizonte: resultado.aniosHorizonte,
        precioEquilibrioUsdTm: resultado.precioEquilibrioUsdTm,
        dimensionamiento: resultado.dimensionamiento,
        evaluaciones: resultado.evaluaciones,
        recomendacion: resultado.recomendacion,
        cambiario: resultado.cambiario,
        advertencias: resultado.advertencias,
        advertenciasDatos: (fila.resultados as { advertenciasDatos?: string[] })
          .advertenciasDatos ?? [],
      }),
    })
    .select("id")
    .single();

  if (error) return { error: `No se pudo guardar el escenario: ${error.message}` };

  revalidatePath("/dashboard");
  redirect(`/analisis/${data.id}`);
}
