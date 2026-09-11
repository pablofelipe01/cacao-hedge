"use server";

import { revalidatePath } from "next/cache";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
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
 * Sincroniza el inventario de bodega desde la hoja de cálculo.
 *
 * La hoja manda: se reemplaza lo que hubiera. Se hace con upsert de las
 * filas vigentes y borrado de las que quedaron atrás, en vez de vaciar y
 * volver a llenar, para que no exista un instante en que el usuario vea
 * el inventario vacío.
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

  const supabase = await crearClienteServidor();
  const momento = new Date().toISOString();

  const { error: errorUpsert } = await supabase.from("inventario_bodega").upsert(
    inventario.filas.map((fila) => ({
      user_id: usuario.id,
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
    .eq("user_id", usuario.id)
    .eq("hoja_id", hojaId)
    .lt("sincronizado_en", momento);

  if (errorBorrado) {
    return { error: `Se sincronizó, pero quedaron filas viejas: ${errorBorrado.message}` };
  }

  revalidatePath("/bodega");
  revalidatePath("/dashboard");

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
