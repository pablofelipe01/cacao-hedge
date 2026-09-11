"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { erroresPorCampo, esquemaLote } from "./esquemas";

export type EstadoFormulario = {
  errores?: Record<string, string>;
  mensaje?: string;
};

/** Alta de un lote de inventario del usuario en sesión. */
export async function crearLote(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const analisis = esquemaLote.safeParse(Object.fromEntries(formData));
  if (!analisis.success) {
    return { errores: erroresPorCampo(analisis.error) };
  }

  const datos = analisis.data;
  const precio = Number(String(datos.precioVentaUsdTm ?? "").replace(",", "."));

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from("inventarios")
    .insert({
      user_id: usuario.id,
      nombre: datos.nombre,
      toneladas: datos.toneladas,
      costo_cop_kg: datos.costoCopKg,
      ubicacion: datos.ubicacion,
      fecha_embarque: datos.fechaEmbarque,
      diferencial_usd_tm: datos.diferencialUsdTm,
      tipo_contrato: datos.tipoContrato,
      precio_venta_usd_tm:
        datos.tipoContrato === "precio_fijo_usd" && Number.isFinite(precio) ? precio : null,
      mes_futuro: datos.mesFuturo ? datos.mesFuturo.toUpperCase() : null,
      notas: datos.notas || null,
    })
    .select("id")
    .single();

  if (error) {
    return { mensaje: `No se pudo guardar el lote: ${error.message}` };
  }

  revalidatePath("/dashboard");
  redirect(`/analisis/nuevo?lote=${data.id}`);
}

/** Baja lógica: el lote deja de aparecer pero sus análisis se conservan. */
export async function archivarLote(formData: FormData): Promise<void> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await crearClienteServidor();
  // RLS se encarga de que solo pueda archivar lo suyo.
  await supabase.from("inventarios").update({ activo: false }).eq("id", id);

  revalidatePath("/dashboard");
}
