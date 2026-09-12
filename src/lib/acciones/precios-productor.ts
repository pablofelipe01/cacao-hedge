"use server";

import { revalidatePath } from "next/cache";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { ErrorDatos } from "@/lib/data/errores";
import {
  descargarPrecios,
  HOJA_PRECIOS_POR_DEFECTO,
} from "@/lib/data/hoja-precios-productor";
import { idDeHoja } from "@/lib/data/hoja-inventario";

export type EstadoPrecios = {
  error?: string;
  mensaje?: string;
  detalle?: {
    precios: number;
    dias: number;
    ultimaFecha: string | null;
    advertencias: string[];
  };
};

/**
 * Trae los precios publicados por Nacional de Chocolates y Casa Luker.
 *
 * A diferencia del inventario, aquí NO se borra lo que no vino: la hoja
 * es una ventana móvil de las últimas semanas y el histórico acumulado
 * vale más que la hoja misma —es lo que permite medir la distribución del
 * descuento en vez de suponerla—. Si la hoja deja de mostrar mayo, mayo
 * sigue siendo un hecho.
 */
export async function sincronizarPreciosProductor(
  _estado: EstadoPrecios,
  formData: FormData,
): Promise<EstadoPrecios> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { error: "Debe iniciar sesión." };

  const hojaId = idDeHoja(String(formData.get("hoja") ?? "") || HOJA_PRECIOS_POR_DEFECTO);
  if (!hojaId) return { error: "Indique la hoja de cálculo." };

  let hoja;
  try {
    hoja = await descargarPrecios(hojaId);
  } catch (error) {
    return {
      error:
        error instanceof ErrorDatos
          ? error.mensajeUsuario
          : "No se pudo leer la hoja de precios.",
    };
  }

  const supabase = await crearClienteServidor();

  // En lotes: dos años de cuatro compradores son varios miles de filas y
  // PostgREST corta las peticiones muy grandes.
  const TAMANO = 500;
  for (let i = 0; i < hoja.precios.length; i += TAMANO) {
    const { error } = await supabase.from("precios_productor").upsert(
      hoja.precios.slice(i, i + TAMANO).map((p) => ({
        user_id: usuario.id,
        hoja_id: hojaId,
        fecha: p.fecha,
        comprador: p.comprador,
        precio_cop_kg: p.precioCopKg,
      })),
      { onConflict: "user_id,hoja_id,fecha,comprador" },
    );

    if (error) {
      return { error: `No se pudieron guardar los precios: ${error.message}` };
    }
  }

  const dias = new Set(hoja.precios.map((p) => p.fecha)).size;

  revalidatePath("/precios");
  revalidatePath("/analisis/nuevo");

  return {
    mensaje: `${hoja.precios.length} precios guardados, de ${dias} días distintos.`,
    detalle: {
      precios: hoja.precios.length,
      dias,
      ultimaFecha: hoja.ultimaFecha,
      advertencias: hoja.advertencias,
    },
  };
}
