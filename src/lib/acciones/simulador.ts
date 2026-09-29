"use server";

import { revalidatePath } from "next/cache";

import { ErrorDatos } from "@/lib/data/errores";
import { simularCaso, type ResultadoCaso } from "@/lib/engine/simulador";
import { cargarContextoSimulador } from "@/lib/simulador/contexto";
import { casoDesdeEntrada, esquemaEntradaCaso, mensajesDeError } from "@/lib/simulador/entrada";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";

export type RespuestaSimulacion =
  | {
      ok: true;
      resultado: ResultadoCaso;
      mercado: { futuroUsdTm: number; trm: number; fechaDatos: string };
      advertenciasMercado: string[];
    }
  | { ok: false; errores: string[] };

/**
 * Calcula un caso hipotético. No guarda nada: es un tanteo, y la posición
 * real de la empresa no debe moverse porque alguien esté explorando.
 */
export async function simularHipotetico(entrada: unknown): Promise<RespuestaSimulacion> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { ok: false, errores: ["Debe iniciar sesión."] };

  const validado = esquemaEntradaCaso.safeParse(entrada);
  if (!validado.success) return { ok: false, errores: mensajesDeError(validado.error) };

  let contexto;
  try {
    contexto = await cargarContextoSimulador(usuario.id);
  } catch (error) {
    return {
      ok: false,
      errores: [error instanceof ErrorDatos ? error.mensajeUsuario : "No se pudieron obtener los datos de mercado."],
    };
  }

  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const resultado = simularCaso(casoDesdeEntrada(validado.data, hoy), contexto.mercado, contexto.supuestos);
    return {
      ok: true,
      resultado,
      mercado: {
        futuroUsdTm: contexto.mercado.futuroUsdTm,
        trm: contexto.mercado.trm,
        fechaDatos: contexto.mercado.fechaDatos,
      },
      advertenciasMercado: contexto.advertenciasMercado,
    };
  } catch (error) {
    return { ok: false, errores: [error instanceof Error ? error.message : "No se pudo calcular el caso."] };
  }
}

/**
 * Cuando la oportunidad se concreta: cada entrega pasa a ser una venta a
 * precio cerrado en /ventas, y desde ese momento cuenta en la posición.
 */
export async function registrarCasoComoVentas(
  entrada: unknown,
): Promise<{ ok: true; ventas: number } | { ok: false; errores: string[] }> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { ok: false, errores: ["Debe iniciar sesión."] };

  const validado = esquemaEntradaCaso.safeParse(entrada);
  if (!validado.success) return { ok: false, errores: mensajesDeError(validado.error) };

  const datos = validado.data;
  if (!datos.comprador) {
    return { ok: false, errores: ["Escriba el comprador para registrar la venta."] };
  }

  const supabase = await crearClienteServidor();
  const total = datos.entregas.length;
  const { error } = await supabase.from("ventas").insert(
    datos.entregas.map((e, i) => ({
      user_id: usuario.id,
      comprador: datos.comprador,
      toneladas: e.toneladas,
      fecha_embarque: e.fecha,
      modalidad: "precio_pactado" as const,
      precio_usd_tm: datos.precioVentaUsdTm,
      notas: `Entrega ${i + 1} de ${total}, desde el simulador. Anticipo ${datos.anticipoPct} %, saldo contra documentos.`,
    })),
  );

  if (error) return { ok: false, errores: [`No se pudo registrar: ${error.message}`] };

  revalidatePath("/ventas");
  revalidatePath("/posicion");
  return { ok: true, ventas: total };
}
