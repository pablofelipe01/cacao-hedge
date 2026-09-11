import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { crearClienteServidor } from "@/lib/supabase/server";
import { CC_TONELADAS_POR_CONTRATO } from "@/lib/engine/constantes";
import { cop, fechaLegible, toneladas, usdTm } from "@/lib/formato";

export default async function PaginaDashboard() {
  const supabase = await crearClienteServidor();

  // RLS ya restringe las filas al usuario de la sesión: no hace falta
  // filtrar por user_id en la consulta.
  const [{ data: lotes, error }, { data: analisis }, { data: bodega }] = await Promise.all([
    supabase
      .from("inventarios")
      .select("id, nombre, toneladas, ubicacion, fecha_embarque, costo_cop_kg, diferencial_usd_tm")
      .eq("activo", true)
      .order("fecha_embarque", { ascending: true }),
    supabase
      .from("analisis")
      .select("id, created_at, entradas, inventario_id")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("inventario_bodega")
      .select("cantidad_disponible_kg, valor_compra_cop_kg, sincronizado_en"),
  ]);

  // Inventario real traído de la hoja operativa, si ya se sincronizó.
  const filasBodega = bodega ?? [];
  const bodegaKg = filasBodega.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const bodegaTm = bodegaKg / 1000;

  const toneladasTotales = (lotes ?? []).reduce((acc, l) => acc + Number(l.toneladas), 0);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Inventario</h1>
          <p className="text-sm text-texto-suave">
            Lotes de cacao en bodega sujetos a cobertura.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/analisis/nuevo"
            className="rounded-md border border-borde px-3 py-1.5 text-sm transition hover:border-cacao"
          >
            Nuevo análisis
          </Link>
          <Link
            href="/inventarios/nuevo"
            className="rounded-md bg-cacao px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cacao-claro"
          >
            Nuevo lote
          </Link>
        </div>
      </header>

      {filasBodega.length > 0 ? (
        <section
          aria-labelledby="bodega"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borde bg-superficie px-4 py-3"
        >
          <div>
            <h2 id="bodega" className="text-xs font-medium text-texto-suave">
              Disponible en bodega (hoja operativa)
            </h2>
            <p className="tabular mt-0.5 text-lg font-semibold">
              {toneladas(bodegaTm)} <span className="text-sm font-normal text-texto-suave">TM</span>
              <span className="ml-3 text-sm font-normal text-texto-suave">
                {(bodegaTm / CC_TONELADAS_POR_CONTRATO).toLocaleString("es-CO", {
                  maximumFractionDigits: 2,
                })}{" "}
                contratos CC · {filasBodega.length} lotes
              </span>
            </p>
          </div>
          <Link href="/bodega" className="text-sm text-cacao hover:underline">
            Ver bodega
          </Link>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          No se pudo cargar el inventario: {error.message}
        </p>
      ) : null}

      {lotes && lotes.length > 0 ? (
        <section aria-labelledby="lotes" className="space-y-3">
          <h2 id="lotes" className="sr-only">Lotes</h2>
          <p className="tabular text-sm text-texto-suave">
            {lotes.length} lote(s) · {toneladas(toneladasTotales)} TM · equivalente a{" "}
            {(toneladasTotales / CC_TONELADAS_POR_CONTRATO).toLocaleString("es-CO", {
              maximumFractionDigits: 1,
            })}{" "}
            contratos CC
          </p>
          <ul className="divide-y divide-borde rounded-lg border border-borde bg-superficie">
            {lotes.map((lote) => (
              <li key={lote.id} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                <div>
                  <Link
                    href={`/inventarios/${lote.id}`}
                    className="font-medium hover:text-cacao hover:underline"
                  >
                    {lote.nombre}
                  </Link>
                  <p className="text-sm text-texto-suave">
                    {lote.ubicacion} · embarque {fechaLegible(lote.fecha_embarque)} ·
                    diferencial {Number(lote.diferencial_usd_tm) > 0 ? "+" : ""}
                    {usdTm(Number(lote.diferencial_usd_tm))} USD/TM
                  </p>
                </div>
                <div className="flex items-baseline gap-4">
                  <p className="tabular text-sm">
                    {toneladas(Number(lote.toneladas))} TM
                    <span className="ml-2 text-texto-suave">
                      {cop(Number(lote.toneladas) * Number(lote.costo_cop_kg) * 1000)} COP
                    </span>
                  </p>
                  <Link
                    href={`/analisis/nuevo?lote=${lote.id}`}
                    className="text-sm text-cacao hover:underline"
                  >
                    Analizar
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="rounded-lg border border-dashed border-borde bg-superficie px-4 py-10 text-center">
          <p className="text-sm text-texto-suave">
            Aún no hay lotes registrados.
          </p>
          <Link
            href="/inventarios/nuevo"
            className="mt-3 inline-block rounded-md bg-cacao px-3 py-1.5 text-sm font-medium text-white"
          >
            Registrar el primero
          </Link>
        </div>
      )}

      {analisis && analisis.length > 0 ? (
        <section aria-labelledby="historial" className="space-y-3">
          <h2 id="historial" className="text-sm font-semibold">Análisis recientes</h2>
          <ul className="divide-y divide-borde rounded-lg border border-borde bg-superficie text-sm">
            {analisis.map((fila) => {
              const entradas = fila.entradas as { toneladas?: number; fechaEmbarque?: string };
              return (
                <li key={fila.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                  <span className="text-texto-suave">
                    {new Date(fila.created_at).toLocaleString("es-CO", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  <span className="tabular">
                    {entradas.toneladas ? `${toneladas(entradas.toneladas)} TM` : "—"}
                  </span>
                  <Link href={`/analisis/${fila.id}`} className="text-cacao hover:underline">
                    Ver
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Disclaimer />
    </div>
  );
}
