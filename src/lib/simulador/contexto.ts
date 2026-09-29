/**
 * Lo que un caso hipotético toma del mundo real: el mercado de hoy, los
 * supuestos del usuario y el descuento de compra medido.
 *
 * Lo usan la acción del formulario y el analista del chat. Tiene que ser
 * el mismo para los dos: si el chat simulara con otro mercado, el caso que
 * pasa al formulario daría cifras distintas de las que acaba de citar.
 */

import "server-only";

import { supuestosDelUsuario } from "@/lib/acciones/supuestos-usuario";
import { descuentoVigente } from "@/lib/data/descuento-productor";
import { elegirProveedor, obtenerMercado } from "@/lib/data/mercado";
import { envDatosMercado, hayClaveServiceRole } from "@/lib/env";
import type { Mercado, Supuestos } from "@/lib/engine/tipos";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { crearClienteServidor } from "@/lib/supabase/server";

export interface ContextoSimulador {
  mercado: Mercado;
  advertenciasMercado: string[];
  supuestos: Supuestos;
  /** Mediana medida del descuento de compra, fracción. null sin datos. */
  descuentoMediano: number | null;
}

/** Descuento de compra si no hay precios del productor: el de /posicion. */
export const DESCUENTO_COMPRA_RESPALDO = -0.23;

export async function cargarContextoSimulador(userId: string): Promise<ContextoSimulador> {
  const supabase = await crearClienteServidor();
  const [{ supuestos: base, volRespaldo }, descuento] = await Promise.all([
    supuestosDelUsuario(userId),
    descuentoVigente(supabase, userId).catch(() => null),
  ]);

  const { barchartApiKey, trmEndpoint, socrataAppToken } = envDatosMercado();
  const mercado = await obtenerMercado({
    cliente: supabase,
    clienteAdmin: hayClaveServiceRole() ? crearClienteAdmin() : undefined,
    proveedor: elegirProveedor(barchartApiKey),
    opcionesTrm: { endpoint: trmEndpoint, appToken: socrataAppToken },
    volCacaoRespaldo: volRespaldo,
  });

  // La dispersión medida del descuento, como en /posicion: es el riesgo
  // que ninguna cobertura en bolsa toca.
  const supuestos =
    descuento && descuento.resumen.desviacion > 0
      ? { ...base, desviacionBaseFraccion: descuento.resumen.desviacion }
      : base;

  return {
    mercado: mercado.mercado,
    advertenciasMercado: mercado.advertencias,
    supuestos,
    descuentoMediano: descuento?.resumen.mediana ?? null,
  };
}
