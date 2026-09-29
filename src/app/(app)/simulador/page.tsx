import { redirect } from "next/navigation";

import { Disclaimer } from "@/components/Disclaimer";
import { descuentoVigente } from "@/lib/data/descuento-productor";
import { DESCUENTO_COMPRA_RESPALDO } from "@/lib/simulador/contexto";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { Simulador } from "./Simulador";

/** El cálculo sale a la red por el precio y la TRM. */
export const maxDuration = 30;

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Casos hipotéticos: una venta que todavía no está cerrada.
 *
 * Nada de lo que se calcula aquí se guarda ni mueve la posición real. Si
 * la oportunidad se concreta, un botón la registra en Ventas.
 */
export default async function PaginaSimulador() {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const supabase = await crearClienteServidor();
  const descuento = await descuentoVigente(supabase, usuario.id).catch(() => null);
  const mediano = descuento?.resumen.mediana ?? null;
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Simulador de casos</h1>
        <p className="max-w-prose text-sm text-texto-suave">
          Para una venta que todavía no ha cerrado: a precio fijo, con entregas parciales, anticipo
          y pago contra documentos. Compara seis formas de cubrirse por lo que protegen y por la
          caja que exigen, y sugiere la que más protege sin salirse de su capital. Nada de esto se
          guarda ni cambia su posición real.
        </p>
      </header>

      <Simulador
        hoy={hoy}
        descuentoMedidoPct={mediano != null ? Math.round(mediano * 1000) / 10 : null}
        descuentoPorDefectoPct={Math.round((mediano ?? DESCUENTO_COMPRA_RESPALDO) * 1000) / 10}
        primeraEntrega={sumarDias(hoy, 30)}
      />

      <Disclaimer />
    </div>
  );
}
