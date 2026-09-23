"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { erroresPorCampo, esquemaVenta, interpretarNumero } from "./esquemas";
import type { EstadoFormulario } from "./inventario";

/** Alta de una venta cerrada del usuario en sesión. */
export async function crearVenta(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const validado = esquemaVenta.safeParse(Object.fromEntries(formData));
  if (!validado.success) {
    return { errores: erroresPorCampo(validado.error) };
  }

  const datos = validado.data;
  const pactada = datos.modalidad === "precio_pactado";

  const supabase = await crearClienteServidor();
  const { error } = await supabase.from("ventas").insert({
    user_id: usuario.id,
    comprador: datos.comprador,
    toneladas: datos.toneladas,
    fecha_embarque: datos.fechaEmbarque,
    modalidad: datos.modalidad,
    // Cada modalidad guarda solo su dato: una venta pactada con un
    // diferencial suelto dejaría la duda de cuál de los dos manda.
    precio_usd_tm: pactada ? interpretarNumero(String(datos.precioUsdTm)) : null,
    diferencial: pactada ? null : interpretarNumero(String(datos.diferencial)),
    unidad_diferencial: pactada ? null : datos.unidadDiferencial,
    notas: datos.notas || null,
  });

  if (error) {
    return { mensaje: `No se pudo guardar la venta: ${error.message}` };
  }

  revalidatePath("/ventas");
  revalidatePath("/posicion");
  redirect("/ventas");
}

/**
 * Baja lógica: una venta embarcada o cancelada deja de contar en la
 * posición, pero se conserva.
 */
export async function archivarVenta(formData: FormData): Promise<void> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await crearClienteServidor();
  // RLS se encarga de que solo pueda archivar lo suyo.
  await supabase.from("ventas").update({ activo: false }).eq("id", id);

  revalidatePath("/ventas");
  revalidatePath("/posicion");
}
