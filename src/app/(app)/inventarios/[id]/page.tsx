import Link from "next/link";
import { notFound } from "next/navigation";

import { Disclaimer } from "@/components/Disclaimer";
import { archivarLote } from "@/lib/acciones/inventario";
import { crearClienteServidor } from "@/lib/supabase/server";
import { CC_TONELADAS_POR_CONTRATO } from "@/lib/engine/constantes";
import { cop, fechaLegible, porcentaje, toneladas, usdTm } from "@/lib/formato";

const NOMBRE_CONTRATO: Record<string, string> = {
  sin_contrato: "Aún sin contrato",
  por_fijar_ny: "Por fijar contra futuros NY",
  precio_fijo_usd: "Precio fijo en USD",
};

/** Forma mínima de lo que el historial necesita de cada análisis guardado. */
interface FilaHistorial {
  id: string;
  created_at: string;
  estado: string;
  informe_md: string | null;
  mercado: { futuroUsdTm?: number; trm?: number } | null;
  resultados: {
    recomendacion?: { nombre?: string };
    evaluaciones?: {
      resumen: { estrategia: { id: string } };
      monteCarlo: { probabilidadPerdida: number; percentiles: { p5: number } };
    }[];
  } | null;
}

export default async function PaginaLote({ params }: PageProps<"/inventarios/[id]">) {
  const { id } = await params;
  const supabase = await crearClienteServidor();

  // RLS restringe ambas consultas al dueño: no hace falta filtrar por usuario.
  const [{ data: lote }, { data: historial }] = await Promise.all([
    supabase.from("inventarios").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("analisis")
      .select("id, created_at, estado, informe_md, mercado, resultados")
      .eq("inventario_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!lote) notFound();

  const filas = (historial ?? []) as unknown as FilaHistorial[];
  const costoTotal = Number(lote.toneladas) * Number(lote.costo_cop_kg) * 1000;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{lote.nombre}</h1>
            {!lote.activo ? (
              <span className="rounded bg-borde px-2 py-0.5 text-xs text-texto-suave">
                archivado
              </span>
            ) : null}
          </div>
          <p className="text-sm text-texto-suave">
            {lote.ubicacion} · embarque {fechaLegible(lote.fecha_embarque)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard"
            className="rounded-md border border-borde px-3 py-1.5 text-sm transition hover:border-cacao"
          >
            ← Inventario
          </Link>
          <Link
            href={`/analisis/nuevo?lote=${lote.id}`}
            className="rounded-md bg-cacao px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cacao-claro"
          >
            Nuevo análisis
          </Link>
        </div>
      </header>

      {/* --- Ficha del lote ---------------------------------------------- */}
      <section aria-labelledby="ficha" className="rounded-lg border border-borde bg-superficie p-4">
        <h2 id="ficha" className="sr-only">Datos del lote</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-texto-suave">Cantidad</dt>
            <dd className="tabular font-medium">
              {toneladas(Number(lote.toneladas))} TM
              <span className="ml-2 font-normal text-texto-suave">
                ≈{" "}
              {(Number(lote.toneladas) / CC_TONELADAS_POR_CONTRATO).toLocaleString("es-CO", {
                maximumFractionDigits: 1,
              })}{" "}
              contratos
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Costo de adquisición</dt>
            <dd className="tabular font-medium">
              {usdTm(Number(lote.costo_cop_kg))} COP/kg
              <span className="ml-2 font-normal text-texto-suave">{cop(costoTotal)} COP</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Diferencial</dt>
            <dd className="tabular font-medium">
              {Number(lote.diferencial_usd_tm) > 0 ? "+" : ""}
              {usdTm(Number(lote.diferencial_usd_tm))} USD/TM
            </dd>
          </div>
          <div>
            <dt className="text-xs text-texto-suave">Contrato de venta</dt>
            <dd className="font-medium">
              {NOMBRE_CONTRATO[lote.tipo_contrato] ?? lote.tipo_contrato}
              {lote.precio_venta_usd_tm != null ? (
                <span className="ml-2 font-normal text-texto-suave">
                  a {usdTm(Number(lote.precio_venta_usd_tm))} USD/TM
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
        {lote.notas ? (
          <p className="mt-4 border-t border-borde pt-3 text-sm text-texto-suave">{lote.notas}</p>
        ) : null}
      </section>

      {/* --- Historial ---------------------------------------------------- */}
      <section aria-labelledby="historial" className="space-y-3">
        <h2 id="historial" className="text-sm font-semibold">
          Historial de análisis
        </h2>
        <p className="text-xs leading-relaxed text-texto-suave">
          Cada análisis guarda su propia fotografía de mercado y sus supuestos, así que
          comparar dos fechas muestra cómo cambió la decisión al moverse el precio, no un
          recálculo con los datos de hoy.
        </p>

        {filas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-borde bg-superficie px-4 py-8 text-center">
            <p className="text-sm text-texto-suave">Este lote todavía no tiene análisis.</p>
          </div>
        ) : (
          <ul className="divide-y divide-borde rounded-lg border border-borde bg-superficie">
            {filas.map((fila) => {
              // La primera evaluación es siempre «sin cobertura»: sirve de
              // referencia del riesgo que había antes de cubrirse.
              const sinCobertura = fila.resultados?.evaluaciones?.[0];

              return (
                <li key={fila.id} className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {fila.resultados?.recomendacion?.nombre ?? "Análisis"}
                    </p>
                    <p className="tabular text-xs text-texto-suave">
                      {new Date(fila.created_at).toLocaleString("es-CO", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {fila.mercado?.futuroUsdTm
                        ? ` · CC ${usdTm(fila.mercado.futuroUsdTm)} USD/TM`
                        : ""}
                      {fila.mercado?.trm ? ` · TRM ${usdTm(fila.mercado.trm)}` : ""}
                    </p>
                  </div>

                  <div className="flex items-baseline gap-4 text-xs">
                    {sinCobertura ? (
                      <span className="tabular text-texto-suave">
                        P(pérdida) sin cubrir{" "}
                        {porcentaje(sinCobertura.monteCarlo.probabilidadPerdida)}
                      </span>
                    ) : null}
                    {fila.informe_md ? (
                      <span className="rounded bg-cacao/15 px-1.5 py-0.5 text-cacao-claro">
                        con informe
                      </span>
                    ) : null}
                    <Link href={`/analisis/${fila.id}`} className="text-cacao hover:underline">
                      Ver
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {lote.activo ? (
        <form action={archivarLote} className="border-t border-borde pt-4">
          <input type="hidden" name="id" value={lote.id} />
          <button
            type="submit"
            className="text-sm text-texto-suave underline-offset-2 hover:text-negativo hover:underline"
          >
            Archivar este lote
          </button>
          <p className="mt-1 text-xs text-texto-suave">
            Deja de aparecer en el inventario. Sus análisis se conservan.
          </p>
        </form>
      ) : null}

      <Disclaimer />
    </div>
  );
}
