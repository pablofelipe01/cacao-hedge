"use server";

import { revalidatePath } from "next/cache";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { erroresPorCampo, esquemaConfiguracion } from "./esquemas";
import type { EstadoFormulario } from "./inventario";

/**
 * Guarda los supuestos de cálculo del usuario.
 *
 * No toca los análisis ya hechos: cada uno guardó los supuestos con que
 * se corrió. Cambiar esto afecta a los siguientes, y esa inmutabilidad es
 * lo que permite volver a abrir un análisis viejo y que siga cuadrando.
 */
export async function guardarConfiguracion(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { mensaje: "Debe iniciar sesión." };

  const validado = esquemaConfiguracion.safeParse(Object.fromEntries(formData));
  if (!validado.success) {
    return { errores: erroresPorCampo(validado.error) };
  }

  const d = validado.data;
  const supabase = await crearClienteServidor();

  // upsert y no update: el trigger crea la fila al registrarse, pero un
  // usuario creado por otra vía podría no tenerla.
  const { error } = await supabase.from("configuracion").upsert({
    user_id: usuario.id,
    margen_inicial_usd: d.margenInicialUsd,
    margen_mantenimiento_usd: d.margenMantenimientoUsd,
    comision_usd_contrato: d.comisionUsdContrato,
    tasa_libre_riesgo: d.tasaLibreRiesgoPorcentaje / 100,
    vol_fallback: d.volFallbackPorcentaje / 100,
    dias_habiles_anio: d.diasHabilesAnio,
    nivel_confianza_var: d.nivelConfianzaVarPorcentaje / 100,
    trayectorias_mc: d.trayectoriasMc,
  });

  if (error) return { mensaje: `No se pudo guardar: ${error.message}` };

  revalidatePath("/configuracion");
  return { mensaje: "Supuestos guardados. Se aplicarán a los próximos análisis." };
}
