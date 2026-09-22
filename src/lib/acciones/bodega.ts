"use server";

import { refresh, revalidatePath } from "next/cache";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import type { ClienteSupabase } from "@/lib/data/cache";
import { ErrorDatos } from "@/lib/data/errores";
import {
  HOJA_INVENTARIO_POR_DEFECTO,
  descargarInventario,
  idDeHoja,
} from "@/lib/data/hoja-inventario";

export type EstadoBodega = {
  error?: string;
  mensaje?: string;
  detalle?: {
    lotes: number;
    totalKg: number;
    totalDeclaradoKg: number | null;
    cuadra: boolean;
  };
};

/**
 * Pasado este tiempo, abrir el inventario vuelve a leer la hoja.
 *
 * Antes solo se actualizaba al pulsar «Sincronizar», y el exportador
 * terminaba mirando kilos que ya habían salido. Leer la hoja cuesta un par
 * de segundos; treinta minutos evita repetirlo en cada clic sin dejar que
 * la pantalla se quede atrás de lo que pasa en la bodega en el día.
 */
const VIGENCIA_MS = 30 * 60 * 1000;

/**
 * Sincroniza el inventario de bodega desde la hoja de cálculo (botón).
 */
export async function sincronizarBodega(
  _estado: EstadoBodega,
  formData: FormData,
): Promise<EstadoBodega> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { error: "Debe iniciar sesión." };

  const hojaId = idDeHoja(
    String(formData.get("hoja") ?? "") || HOJA_INVENTARIO_POR_DEFECTO,
  );
  if (!hojaId) return { error: "Indique la hoja de cálculo." };

  const supabase = await crearClienteServidor();
  const estado = await sincronizarDesdeHoja(supabase, usuario.id, hojaId);
  if (!estado.error) revalidatePath("/dashboard");
  return estado;
}

/**
 * Sincroniza solo si lo que hay en la base es viejo. La llama la pantalla
 * de inventario al abrirse.
 *
 * Usa la misma hoja de la última sincronización: si el usuario apuntó a
 * otra con el botón, abrir la pantalla no debe devolverlo a la de defecto.
 */
export async function sincronizarBodegaSiVieja(): Promise<{
  actualizado: boolean;
  error?: string;
}> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { actualizado: false };

  const supabase = await crearClienteServidor();
  const { data: ultima } = await supabase
    .from("inventario_bodega")
    .select("hoja_id, sincronizado_en")
    .order("sincronizado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultima && Date.now() - new Date(ultima.sincronizado_en).getTime() < VIGENCIA_MS) {
    return { actualizado: false };
  }

  const estado = await sincronizarDesdeHoja(
    supabase,
    usuario.id,
    ultima?.hoja_id ?? HOJA_INVENTARIO_POR_DEFECTO,
  );
  if (estado.error) return { actualizado: false, error: estado.error };

  // La pantalla ya se pintó con los datos viejos: hay que volver a pedirla.
  refresh();
  return { actualizado: true };
}

/**
 * Trae la hoja y la vuelca a la base.
 *
 * La hoja manda: se reemplaza lo que hubiera. Se hace con upsert de las
 * filas vigentes y borrado de las que quedaron atrás, en vez de vaciar y
 * volver a llenar, para que no exista un instante en que el usuario vea
 * el inventario vacío.
 */
async function sincronizarDesdeHoja(
  supabase: ClienteSupabase,
  userId: string,
  hojaId: string,
): Promise<EstadoBodega> {
  let inventario;
  try {
    inventario = await descargarInventario(hojaId);
  } catch (error) {
    return {
      error:
        error instanceof ErrorDatos
          ? error.mensajeUsuario
          : "No se pudo leer la hoja de cálculo.",
    };
  }

  if (inventario.filas.length === 0) {
    return { error: "La hoja no tiene ningún lote con saldo en bodega." };
  }

  const momento = new Date().toISOString();

  const { error: errorUpsert } = await supabase.from("inventario_bodega").upsert(
    inventario.filas.map((fila) => ({
      user_id: userId,
      hoja_id: hojaId,
      fila: fila.fila,
      fecha_ingreso: fila.fechaIngreso,
      codigo_procedencia: fila.codigoProcedencia,
      valor_compra_cop_kg: fila.valorCompraCopKg,
      cantidad_ingresada_kg: fila.cantidadIngresadaKg,
      cantidad_salida_kg: fila.cantidadSalidaKg,
      cantidad_disponible_kg: fila.cantidadDisponibleKg,
      sincronizado_en: momento,
    })),
    { onConflict: "user_id,hoja_id,fila" },
  );

  if (errorUpsert) {
    return { error: `No se pudo guardar el inventario: ${errorUpsert.message}` };
  }

  // Lo que no se tocó en esta sincronización ya no está en la hoja: se fue.
  const { error: errorBorrado } = await supabase
    .from("inventario_bodega")
    .delete()
    .eq("user_id", userId)
    .eq("hoja_id", hojaId)
    .lt("sincronizado_en", momento);

  if (errorBorrado) {
    return { error: `Se sincronizó, pero quedaron filas viejas: ${errorBorrado.message}` };
  }

  return {
    mensaje: `Inventario actualizado: ${inventario.filas.length} lote(s) con saldo.`,
    detalle: {
      lotes: inventario.filas.length,
      totalKg: inventario.totalKg,
      totalDeclaradoKg: inventario.totalDeclaradoKg,
      cuadra: inventario.totalCuadra,
    },
  };
}
