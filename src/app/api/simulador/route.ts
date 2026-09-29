import { NextResponse } from "next/server";

import { ErrorAnalista } from "@/lib/anthropic/analista";
import { responderSimulador, type TurnoSimulador } from "@/lib/anthropic/simulador";
import { ErrorDatos } from "@/lib/data/errores";
import { cargarContextoSimulador } from "@/lib/simulador/contexto";
import { esquemaEntradaCaso } from "@/lib/simulador/entrada";
import { obtenerUsuario } from "@/lib/supabase/server";

/** Cada simulación es una vuelta a la API; varias encadenadas pasan de 10 s. */
export const maxDuration = 120;

const MAX_HISTORIAL = 12;

/**
 * El analista del simulador.
 *
 * El caso en pantalla SÍ viene del navegador —es hipotético por
 * definición, lo escribió el usuario—, pero solo sus ENTRADAS. Los
 * resultados se recalculan aquí con el mercado real: el modelo nunca ve
 * una cifra de resultado que no haya producido el motor en el servidor.
 */
export async function POST(peticion: Request) {
  const usuario = await obtenerUsuario();
  if (!usuario) return NextResponse.json({ error: "Debe iniciar sesión." }, { status: 401 });

  let cuerpo: { entrada?: unknown; pregunta?: string; historial?: TurnoSimulador[] };
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: "Petición mal formada." }, { status: 400 });
  }

  const pregunta = (cuerpo.pregunta ?? "").trim();
  if (!pregunta) return NextResponse.json({ error: "Escriba una pregunta." }, { status: 400 });
  if (pregunta.length > 4000) {
    return NextResponse.json({ error: "El mensaje es demasiado largo." }, { status: 400 });
  }

  // Un caso a medio llenar no es un error: el chat sirve justamente para
  // armarlo. Se ignora y el modelo arranca desde cero.
  const validada = esquemaEntradaCaso.safeParse(cuerpo.entrada);
  const entrada = validada.success ? validada.data : null;

  let contexto;
  try {
    contexto = await cargarContextoSimulador(usuario.id);
  } catch (error) {
    const mensaje = error instanceof ErrorDatos ? error.mensajeUsuario : "No se pudieron obtener los datos de mercado.";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }

  try {
    const respuesta = await responderSimulador(
      contexto,
      entrada,
      (cuerpo.historial ?? []).slice(-MAX_HISTORIAL),
      pregunta,
      new Date().toISOString().slice(0, 10),
    );
    return NextResponse.json(respuesta);
  } catch (error) {
    if (error instanceof ErrorAnalista) {
      return NextResponse.json({ error: error.mensajeUsuario }, { status: 502 });
    }
    return NextResponse.json({ error: "No se pudo responder." }, { status: 500 });
  }
}
