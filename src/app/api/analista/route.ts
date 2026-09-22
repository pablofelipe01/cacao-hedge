import { NextResponse } from "next/server";

import { obtenerUsuario, crearClienteServidor } from "@/lib/supabase/server";
import { ErrorAnalista, responderAnalista, type TurnoChat } from "@/lib/anthropic/analista";
import { contextoDesdeFila } from "@/lib/anthropic/contexto-analisis";
import { construirResumen } from "@/lib/anthropic/resumen";

/**
 * Una respuesta puede encadenar varios recálculos, y cada vuelta es una
 * llamada a la API. Con el límite por defecto de 10 s se cortaría.
 */
export const maxDuration = 120;

/** Tope de turnos que se le reenvían al modelo. */
const MAX_HISTORIAL = 12;

/**
 * El analista responde sobre un análisis concreto.
 *
 * El contexto NO viene del cliente: se reconstruye en el servidor desde
 * la fila guardada. Si viniera del navegador, cualquiera podría pedirle
 * al modelo que razonara sobre cifras inventadas y presentarlo como
 * salida de la herramienta.
 */
export async function POST(peticion: Request) {
  const usuario = await obtenerUsuario();
  if (!usuario) {
    return NextResponse.json({ error: "Debe iniciar sesión." }, { status: 401 });
  }

  let cuerpo: { analisisId?: string; pregunta?: string; historial?: TurnoChat[] };
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: "Petición mal formada." }, { status: 400 });
  }

  const pregunta = (cuerpo.pregunta ?? "").trim();
  if (!pregunta) {
    return NextResponse.json({ error: "Escriba una pregunta." }, { status: 400 });
  }
  if (pregunta.length > 2000) {
    return NextResponse.json({ error: "La pregunta es demasiado larga." }, { status: 400 });
  }

  const supabase = await crearClienteServidor();
  // RLS restringe la fila al dueño: si no aparece, no es suya.
  const { data: analisis } = await supabase
    .from("analisis")
    .select("entradas, mercado, supuestos, resultados")
    .eq("id", cuerpo.analisisId ?? "")
    .maybeSingle();

  if (!analisis?.resultados) {
    return NextResponse.json({ error: "No se encontró el análisis." }, { status: 404 });
  }

  const { contexto, resultados } = contextoDesdeFila(analisis);
  const { lote, procedencia } = contexto;

  const resumenActual = construirResumen({
    lote,
    fechaEmbarque: contexto.fechaEmbarque,
    mercado: contexto.mercado,
    supuestos: contexto.supuestos,
    evaluaciones: resultados.evaluaciones,
    recomendacion: resultados.recomendacion,
    precioEquilibrioUsdTm: resultados.precioEquilibrioUsdTm,
    dimensionamiento: resultados.dimensionamiento,
    procedencia,
    advertencias: [...resultados.advertencias, ...(resultados.advertenciasDatos ?? [])],
  });

  try {
    const respuesta = await responderAnalista(
      contexto,
      resumenActual,
      (cuerpo.historial ?? []).slice(-MAX_HISTORIAL),
      pregunta,
    );
    return NextResponse.json(respuesta);
  } catch (error) {
    if (error instanceof ErrorAnalista) {
      return NextResponse.json({ error: error.mensajeUsuario }, { status: 502 });
    }
    return NextResponse.json({ error: "No se pudo responder." }, { status: 500 });
  }
}
