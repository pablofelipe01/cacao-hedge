import Link from "next/link";

import { archivarVenta } from "@/lib/acciones/ventas";
import { describirPrecio } from "@/lib/data/ventas";
import { claveMes, etiquetaMes } from "@/lib/engine/consolidado";
import { fechaLegible, toneladas } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";
import { FormularioVenta } from "./FormularioVenta";

/**
 * Las ventas cerradas que faltan por embarcar.
 *
 * No están en ninguna hoja del cliente, así que se registran aquí. Junto
 * con la bodega forman la posición de la empresa.
 */
export default async function PaginaVentas() {
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from("ventas")
    .select("*")
    .eq("activo", true)
    .order("fecha_embarque", { ascending: true });

  const ventas = data ?? [];
  const total = ventas.reduce((a, v) => a + Number(v.toneladas), 0);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Ventas</h1>
            <p className="text-sm text-texto-suave">
              Lo que ya vendió y falta por embarcar, a precio cerrado o por fijar contra
              Nueva York.
            </p>
          </div>
          <Link
            href="/posicion"
            className="rounded-md border border-borde px-3 py-1.5 text-sm transition hover:border-cacao"
          >
            Ver la posición mes a mes
          </Link>
        </div>
      </header>

      {error ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          No se pudieron cargar las ventas: {error.message}
        </p>
      ) : null}

      <section aria-labelledby="pendientes" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pendientes" className="text-sm font-semibold">Pendientes de embarque</h2>
          {ventas.length > 0 ? (
            <p className="tabular text-xs text-texto-suave">
              {ventas.length} venta(s) · {toneladas(total)} TM
            </p>
          ) : null}
        </div>

        {ventas.length === 0 ? (
          <p className="rounded-md border border-dashed border-borde px-3 py-6 text-center text-sm text-texto-suave">
            Todavía no hay ventas registradas.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-borde bg-superficie">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Ventas cerradas pendientes de embarque.</caption>
              <thead>
                <tr className="border-b border-borde text-xs text-texto-suave">
                  <th scope="col" className="px-3 py-2 text-left font-medium">Comprador</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Embarque</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Toneladas</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Precio</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} className="border-b border-borde/60 last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {v.comprador}
                      {v.notas ? (
                        <span className="block text-xs text-texto-suave">{v.notas}</span>
                      ) : null}
                    </th>
                    <td className="px-3 py-2 text-texto-suave">
                      {fechaLegible(v.fecha_embarque)}
                      <span className="block text-xs">cuenta en {etiquetaMes(claveMes(v.fecha_embarque))}</span>
                    </td>
                    <td className="tabular px-3 py-2 text-right">{toneladas(Number(v.toneladas))}</td>
                    <td className="px-3 py-2">
                      <span className="tabular">{describirPrecio(v)}</span>
                      <span className="block text-xs text-texto-suave">
                        {v.modalidad === "precio_pactado" ? "precio cerrado" : "por fijar"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <form action={archivarVenta}>
                        <input type="hidden" name="id" value={v.id} />
                        <button
                          type="submit"
                          className="text-xs text-texto-suave underline underline-offset-2 hover:text-texto"
                          title="Deja de contar en la posición. No se borra."
                        >
                          Embarcada o cancelada
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="nueva" className="max-w-2xl space-y-3">
        <h2 id="nueva" className="text-sm font-semibold">Registrar una venta</h2>
        <FormularioVenta />
      </section>
    </div>
  );
}
