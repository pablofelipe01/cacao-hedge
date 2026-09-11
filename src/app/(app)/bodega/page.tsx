import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { TarjetaMetrica } from "@/components/TarjetaMetrica";
import { crearClienteServidor } from "@/lib/supabase/server";
import { CC_TONELADAS_POR_CONTRATO } from "@/lib/engine/constantes";
import { dimensionarCobertura } from "@/lib/engine/contratos";
import { cop, fechaLegible, toneladas, usdTm } from "@/lib/formato";
import { FormularioSincronizar } from "./FormularioSincronizar";

/**
 * Estas páginas lanzan acciones que salen a la red —datos de mercado, TRM,
 * la hoja de cálculo— y el arranque en frío puede superar el límite por
 * defecto de 10 segundos.
 */
export const maxDuration = 30;

export default async function PaginaBodega() {
  const supabase = await crearClienteServidor();

  const { data: filas } = await supabase
    .from("inventario_bodega")
    .select("*")
    .order("cantidad_disponible_kg", { ascending: false });

  const lotes = filas ?? [];
  const totalKg = lotes.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const tm = totalKg / 1000;

  // Costo ponderado solo sobre los kilos que declaran precio de compra:
  // promediar los que no lo traen inventaría un costo que nadie pagó.
  const conCosto = lotes.filter((f) => f.valor_compra_cop_kg != null);
  const kgConCosto = conCosto.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const costoPonderado =
    kgConCosto > 0
      ? conCosto.reduce(
          (a, f) => a + Number(f.valor_compra_cop_kg) * Number(f.cantidad_disponible_kg),
          0,
        ) / kgConCosto
      : null;

  const dim = tm > 0 ? dimensionarCobertura(tm, 1) : null;
  const sincronizado = lotes[0]?.sincronizado_en ?? null;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Bodega</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-texto-suave">
          Espejo de la columna <strong>CANTIDAD DISPONIBLE EN BODEGA</strong> de la hoja
          operativa. La hoja manda: cada sincronización reemplaza lo que hubiera aquí.
        </p>
      </header>

      <FormularioSincronizar />

      {lotes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-borde bg-superficie px-4 py-10 text-center">
          <p className="text-sm text-texto-suave">
            Todavía no se ha sincronizado ningún inventario.
          </p>
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
                detalle={`${totalKg.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg en ${lotes.length} lotes`}
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

          <section aria-labelledby="lotes" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="lotes" className="text-sm font-semibold">Lotes con saldo</h2>
              {sincronizado ? (
                <p className="text-xs text-texto-suave">
                  Sincronizado el{" "}
                  {new Date(sincronizado).toLocaleString("es-CO", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-lg border border-borde bg-superficie">
              <table className="w-full min-w-[620px] text-sm">
                <caption className="sr-only">
                  Lotes con saldo disponible en bodega, según la hoja operativa.
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
                  {lotes.map((lote) => (
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

          <Link
            href={`/analisis/nuevo?toneladas=${tm.toFixed(4)}${costoPonderado ? `&costo=${Math.round(costoPonderado)}` : ""}`}
            className="inline-block rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro"
          >
            Analizar cobertura de estas {toneladas(tm)} TM
          </Link>
        </>
      )}

      <Disclaimer />
    </div>
  );
}
