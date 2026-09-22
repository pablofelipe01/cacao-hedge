import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { TarjetaMetrica } from "@/components/TarjetaMetrica";
import { crearClienteServidor } from "@/lib/supabase/server";
import { CC_TONELADAS_POR_CONTRATO } from "@/lib/engine/constantes";
import { dimensionarCobertura } from "@/lib/engine/contratos";
import { cop, fechaLegible, toneladas, usdTm } from "@/lib/formato";
import { FormularioSincronizar } from "./FormularioSincronizar";
import { SincronizacionAutomatica } from "./SincronizacionAutomatica";

/**
 * La sincronización automática sale a la red a leer la hoja, y el
 * arranque en frío puede superar el límite por defecto de 10 segundos.
 */
export const maxDuration = 30;

/**
 * El inventario, en una sola pantalla.
 *
 * Antes había dos: «Inventario», con lotes escritos a mano, y «Bodega»,
 * espejo de la hoja operativa. Hablaban del mismo cacao y el exportador
 * no tenía por qué saber cuál mirar. Ahora manda la hoja —es donde vive
 * el inventario de verdad— y los lotes a mano quedan debajo, para
 * simular operaciones que todavía no están en ella.
 */
export default async function PaginaInventario() {
  const supabase = await crearClienteServidor();

  // RLS ya restringe las filas al usuario de la sesión: no hace falta
  // filtrar por user_id en la consulta.
  const [{ data: filas }, { data: lotes, error }, { data: analisis }] = await Promise.all([
    supabase
      .from("inventario_bodega")
      .select("*")
      .order("cantidad_disponible_kg", { ascending: false }),
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
  ]);

  const bodega = filas ?? [];
  const totalKg = bodega.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const tm = totalKg / 1000;

  // Costo ponderado solo sobre los kilos que declaran precio de compra:
  // promediar los que no lo traen inventaría un costo que nadie pagó.
  const conCosto = bodega.filter((f) => f.valor_compra_cop_kg != null);
  const kgConCosto = conCosto.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const costoPonderado =
    kgConCosto > 0
      ? conCosto.reduce(
          (a, f) => a + Number(f.valor_compra_cop_kg) * Number(f.cantidad_disponible_kg),
          0,
        ) / kgConCosto
      : null;

  const dim = tm > 0 ? dimensionarCobertura(tm, 1) : null;
  const sincronizado = bodega.reduce<string | null>(
    (ultimo, f) => (!ultimo || f.sincronizado_en > ultimo ? f.sincronizado_en : ultimo),
    null,
  );

  const lotesManuales = lotes ?? [];
  const toneladasManuales = lotesManuales.reduce((acc, l) => acc + Number(l.toneladas), 0);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Inventario</h1>
            <p className="text-sm text-texto-suave">
              El cacao que tiene en bodega, leído de la hoja de inventario.
            </p>
          </div>
          <Link
            href="/analisis/nuevo"
            className="rounded-md border border-borde px-3 py-1.5 text-sm transition hover:border-cacao"
          >
            Nuevo análisis
          </Link>
        </div>
        <SincronizacionAutomatica sincronizadoEn={sincronizado} />
      </header>

      {bodega.length === 0 ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-borde bg-superficie px-4 py-10 text-center">
            <p className="text-sm text-texto-suave">
              Todavía no hay inventario leído de la hoja.
            </p>
          </div>
          <FormularioSincronizar />
        </div>
      ) : (
        <>
          <section aria-labelledby="resumen">
            <h2 id="resumen" className="sr-only">Resumen</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TarjetaMetrica
                etiqueta="Disponible en bodega"
                valor={toneladas(tm)}
                unidad="TM"
                detalle={`${totalKg.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg en ${bodega.length} lotes`}
              />
              <TarjetaMetrica
                etiqueta="Equivale a"
                valor={(tm / CC_TONELADAS_POR_CONTRATO).toLocaleString("es-CO", {
                  maximumFractionDigits: 2,
                })}
                unidad="contratos CC"
                detalle={`un contrato cubre ${CC_TONELADAS_POR_CONTRATO} TM`}
              />
              <TarjetaMetrica
                etiqueta="Costo ponderado"
                valor={costoPonderado ? usdTm(costoPonderado) : "—"}
                unidad={costoPonderado ? "COP/kg" : undefined}
                detalle={
                  costoPonderado
                    ? `sobre ${((kgConCosto / totalKg) * 100).toFixed(0)} % de los kilos`
                    : "ningún lote declara precio de compra"
                }
              />
              <TarjetaMetrica
                etiqueta="Valor del inventario"
                valor={costoPonderado ? cop(costoPonderado * totalKg) : "—"}
                unidad={costoPonderado ? "COP" : undefined}
                detalle="al costo de compra declarado"
              />
            </div>
          </section>

          {/* El descalce con el tamaño de contrato es la restricción real
              a esta escala, así que se dice antes que nada. */}
          {dim ? (
            <section
              aria-labelledby="granularidad"
              className="rounded-lg border border-ambar/40 bg-ambar/5 p-4"
            >
              <h2 id="granularidad" className="text-sm font-semibold">
                Qué se puede cubrir con este inventario
              </h2>
              <p className="mt-1 text-sm leading-relaxed">
                {toneladas(tm)} TM equivalen a{" "}
                <span className="tabular font-medium">
                  {dim.contratosExactos.toLocaleString("es-CO", { maximumFractionDigits: 2 })}
                </span>{" "}
                contratos, y un contrato CC no se puede partir.
              </p>
              <ul className="mt-3 space-y-1.5 text-sm text-texto-suave">
                <li>
                  <span className="font-medium text-texto">
                    {dim.subcobertura.contratos} contrato(s):
                  </span>{" "}
                  {dim.subcobertura.exposicionResidual}
                </li>
                <li>
                  <span className="font-medium text-texto">
                    {dim.sobrecobertura.contratos} contrato(s):
                  </span>{" "}
                  {dim.sobrecobertura.exposicionResidual}
                </li>
              </ul>
            </section>
          ) : null}

          <Link
            href={`/analisis/nuevo?toneladas=${tm.toFixed(4)}${costoPonderado ? `&costo=${Math.round(costoPonderado)}` : ""}`}
            className="inline-block rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro"
          >
            Analizar cobertura de estas {toneladas(tm)} TM
          </Link>

          <section aria-labelledby="lotes-bodega" className="space-y-3">
            <h2 id="lotes-bodega" className="text-sm font-semibold">Lotes con saldo</h2>

            <div className="overflow-x-auto rounded-lg border border-borde bg-superficie">
              <table className="w-full min-w-[620px] text-sm">
                <caption className="sr-only">
                  Lotes con saldo disponible en bodega, según la hoja de inventario.
                </caption>
                <thead>
                  <tr className="border-b border-borde text-xs text-texto-suave">
                    <th scope="col" className="px-3 py-2 text-left font-medium">Código de procedencia</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Ingreso</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Disponible</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">% del total</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Costo</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Fila</th>
                  </tr>
                </thead>
                <tbody>
                  {bodega.map((lote) => (
                    <tr key={lote.id} className="border-b border-borde/60 last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        {lote.codigo_procedencia}
                      </th>
                      <td className="px-3 py-2 text-texto-suave">
                        {lote.fecha_ingreso ? fechaLegible(lote.fecha_ingreso) : "—"}
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {Number(lote.cantidad_disponible_kg).toLocaleString("es-CO", {
                          maximumFractionDigits: 2,
                        })}{" "}
                        kg
                      </td>
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
                        {((Number(lote.cantidad_disponible_kg) / totalKg) * 100).toFixed(1)} %
                      </td>
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
                        {lote.valor_compra_cop_kg != null
                          ? `${usdTm(Number(lote.valor_compra_cop_kg))} COP/kg`
                          : "—"}
                      </td>
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
                        {lote.fila}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-borde px-3 py-2 text-xs text-texto-suave">
                La columna «Fila» es la posición en la hoja de cálculo: sirve para
                rastrear cualquier cifra hasta su origen.
              </p>
            </div>
          </section>
        </>
      )}

      {/* --- Lotes a mano: para lo que todavía no está en la hoja. --- */}
      <section aria-labelledby="lotes-manuales" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="lotes-manuales" className="text-sm font-semibold">Lotes registrados a mano</h2>
            <p className="text-xs text-texto-suave">
              Para simular una operación que todavía no está en la hoja.
            </p>
          </div>
          <Link href="/inventarios/nuevo" className="text-sm text-cacao hover:underline">
            Nuevo lote
          </Link>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
            No se pudieron cargar los lotes: {error.message}
          </p>
        ) : null}

        {lotesManuales.length > 0 ? (
          <>
            <p className="tabular text-xs text-texto-suave">
              {lotesManuales.length} lote(s) · {toneladas(toneladasManuales)} TM
            </p>
            <ul className="divide-y divide-borde rounded-lg border border-borde bg-superficie">
              {lotesManuales.map((lote) => (
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
          </>
        ) : (
          <p className="rounded-md border border-dashed border-borde px-3 py-2 text-xs text-texto-suave">
            Ninguno por ahora.
          </p>
        )}
      </section>

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

      {bodega.length > 0 ? (
        <details className="rounded-lg border border-borde bg-superficie px-4 py-3 text-sm">
          <summary className="cursor-pointer text-texto-suave hover:text-texto">
            Leer la hoja ahora o cambiar de hoja
          </summary>
          <div className="mt-4">
            <FormularioSincronizar />
          </div>
        </details>
      ) : null}

      <Disclaimer />
    </div>
  );
}
