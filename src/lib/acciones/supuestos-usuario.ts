/**
 * Los supuestos de cálculo de un usuario.
 *
 * Fuera de `analisis.ts` porque también los usa la posición consolidada,
 * y un módulo con "use server" solo puede exportar acciones.
 */

import { crearClienteServidor } from "@/lib/supabase/server";
import { margenMantenimientoDesdeInicial } from "@/lib/engine/constantes";
import { SUPUESTOS_POR_DEFECTO, type Supuestos } from "@/lib/engine/tipos";

/**
 * Supuestos del usuario más la volatilidad de respaldo, que no forma
 * parte de `Supuestos` porque no la consume el motor sino la capa de
 * datos: solo se usa cuando la serie histórica no alcanza.
 */
export interface SupuestosCompletos {
  supuestos: Supuestos;
  volRespaldo: number;
}

/** Lee los supuestos del usuario, cayendo a los valores por defecto. */
export async function supuestosDelUsuario(userId: string): Promise<SupuestosCompletos> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("configuracion")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { supuestos: SUPUESTOS_POR_DEFECTO, volRespaldo: 0.35 };

  return {
    supuestos: {
      ...SUPUESTOS_POR_DEFECTO,
      margenInicialUsd: Number(data.margen_inicial_usd),
      // Del inicial y no de la columna: las filas guardadas antes de que se
      // derivara conservan el 7.200 por defecto que nadie confirmó.
      margenMantenimientoUsd: margenMantenimientoDesdeInicial(Number(data.margen_inicial_usd)),
      comisionUsdContrato: Number(data.comision_usd_contrato),
      tasaLibreRiesgo: Number(data.tasa_libre_riesgo),
      diasHabilesAnio: data.dias_habiles_anio,
      nivelConfianzaVar: Number(data.nivel_confianza_var),
      trayectoriasMc: data.trayectorias_mc,
    },
    volRespaldo: Number(data.vol_fallback),
  };
}
