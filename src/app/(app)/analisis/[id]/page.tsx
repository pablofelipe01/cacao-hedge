import Link from "next/link";
import { notFound } from "next/navigation";

import { Disclaimer } from "@/components/Disclaimer";
import { TablaEstrategias } from "@/components/TablaEstrategias";
import { TarjetaMetrica } from "@/components/TarjetaMetrica";
import { InformeNarrativo } from "./InformeNarrativo";
import { SelectorEstrategia } from "./SelectorEstrategia";
import { crearClienteServidor } from "@/lib/supabase/server";
import { cop, fechaLegible, porcentaje, toneladas, usdTm } from "@/lib/formato";
import type { EvaluacionEstrategia, Recomendacion } from "@/lib/engine/index";
import type { DimensionamientoCobertura } from "@/lib/engine/contratos";
import type { TipoOperacion } from "@/lib/engine/tipos";

interface ResultadosGuardados {
  /** Ausente en los análisis guardados antes del caso A: todos eran de inventario. */
  operacion?: TipoOperacion;
  aniosHorizonte: number;
  precioEquilibrioUsdTm: number;
  dimensionamiento: DimensionamientoCobertura;
  evaluaciones: EvaluacionEstrategia[];
  recomendacion: Recomendacion;
  advertencias: string[];
  advertenciasDatos: string[];
}

interface MercadoGuardado {
  futuroUsdTm: number;
  trm: number;
  volAnualizada: number;
  volTrmAnualizada: number;
  fechaDatos: string;
  procedencia?: {
    cacao: { fuente: string; simbolo: string; barras: number; desdeCache: boolean };
    trm: { fuente: string; barras: number; desdeCache: boolean };
  };
}

interface EntradasGuardadas {
  toneladas: number;
  costoCopKg: number;
  fechaEmbarque: string;
  diferencialUsdTm: number;
  tipoContrato: string;
  diasAEmbarque: number;
}

/**
 * Tiempo máximo de la función, en segundos.
 *
 * Las acciones de servidor se ejecutan en el contexto de la página desde
 * la que se invocan, y generar el informe narrativo tarda alrededor de 55
 * segundos: con el límite por defecto de 10 s de una función serverless
 * se cortaría siempre. 60 es el techo del plan Hobby de Vercel; si el
 * modelo tarda más, hace falta un plan con límite mayor o bajar el
 * esfuerzo de redacción.
 */
export const maxDuration = 60;

export default async function PaginaResultados({ params }: PageProps<"/analisis/[id]">) {
  const { id } = await params;
  const supabase = await crearClienteServidor();

  // RLS ya restringe la fila al dueño: si no aparece, no es suya o no existe.
  const { data: analisis } = await supabase
    .from("analisis")
    .select("id, created_at, entradas, mercado, resultados, inventario_id, informe_md, informe_meta")
    .eq("id", id)
    .maybeSingle();

  if (!analisis?.resultados) notFound();

  const resultados = analisis.resultados as unknown as ResultadosGuardados;
  const mercado = analisis.mercado as unknown as MercadoGuardado;
  const entradas = analisis.entradas as unknown as EntradasGuardadas;

  const { evaluaciones, recomendacion } = resultados;
  const recomendada =
    evaluaciones.find((e) => e.resumen.estrategia.id === recomendacion.idEstrategia) ??
    evaluaciones[0];
  const sinCobertura = evaluaciones.find((e) => e.resumen.estrategia.tipo === "sin_cobertura");

  // Con inventario el nominal es lo que espera cobrar; con una venta ya
  // cerrada, lo que espera pagar para abastecerse. Mismo cálculo, lectura
  // opuesta: etiquetarlo mal invierte el sentido de toda la pantalla.
  const esInventario = (resultados.operacion ?? "inventario_sin_vender") === "inventario_sin_vender";
  const nominalUsd = entradas.toneladas * (mercado.futuroUsdTm + entradas.diferencialUsdTm);

  const { subcobertura, sobrecobertura } = resultados.dimensionamiento;
  const alternativasDimensionamiento =
    subcobertura.contratos === sobrecobertura.contratos
      ? [subcobertura]
      : [subcobertura, sobrecobertura];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Análisis de cobertura</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="text-sm text-texto-suave">
          {toneladas(entradas.toneladas)} TM{" "}
          {esInventario ? "en bodega" : "por comprar"} ·{" "}
          {esInventario ? "embarque" : "entrega"} {fechaLegible(entradas.fechaEmbarque)} (
          {entradas.diasAEmbarque} días) · diferencial{" "}
          {entradas.diferencialUsdTm > 0 ? "+" : ""}
          {usdTm(entradas.diferencialUsdTm)} USD/TM
        </p>
      </header>

      {/* --- Recomendación --------------------------------------------- */}
      <section className="rounded-lg border border-ambar/40 bg-ambar/5 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ambar">
          Estrategia recomendada
        </p>
        <h2 className="mt-1 text-lg font-semibold">{recomendacion.nombre}</h2>
        <p className="mt-2 text-sm leading-relaxed">{recomendacion.justificacion}</p>
        <p className="mt-2 text-xs text-texto-suave">Criterio: {recomendacion.criterio}.</p>
      </section>

      {/* --- Métricas clave -------------------------------------------- */}
      <section aria-labelledby="metricas">
        <h2 id="metricas" className="sr-only">Métricas clave</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TarjetaMetrica
            etiqueta="Futuro CC de referencia"
            valor={usdTm(mercado.futuroUsdTm)}
            unidad="USD/TM"
            detalle={`al ${fechaLegible(mercado.fechaDatos)} · vol. ${porcentaje(mercado.volAnualizada)}`}
          />
          <TarjetaMetrica
            etiqueta="TRM"
            valor={usdTm(mercado.trm, 2)}
            unidad="COP/USD"
            detalle={`vol. anualizada ${porcentaje(mercado.volTrmAnualizada)}`}
          />
          <TarjetaMetrica
            etiqueta={esInventario ? "Exposición nominal" : "Costo esperado de la compra"}
            valor={cop(nominalUsd * mercado.trm)}
            unidad="COP"
            detalle={`${usdTm(nominalUsd)} USD ${esInventario ? "al precio efectivo esperado" : "a la bolsa de hoy más el diferencial"}`}
          />
          <TarjetaMetrica
            etiqueta={esInventario ? "Punto de equilibrio" : "Precio máximo de compra"}
            valor={usdTm(resultados.precioEquilibrioUsdTm)}
            unidad="USD/TM"
            detalle={
              esInventario
                ? "costo del lote a la TRM vigente"
                : "por encima de aquí, la venta ya cerrada deja de dar margen"
            }
          />
        </div>
      </section>

      {/* --- Qué cambia cubrirse ---------------------------------------- */}
      {sinCobertura ? (
        <section aria-labelledby="comparacion-riesgo" className="space-y-3">
          <h2 id="comparacion-riesgo" className="text-sm font-semibold">
            Qué cambia cubrirse
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <TarjetaMetrica
              etiqueta="Probabilidad de pérdida"
              valor={porcentaje(recomendada.monteCarlo.probabilidadPerdida)}
              tono={
                recomendada.monteCarlo.probabilidadPerdida <
                sinCobertura.monteCarlo.probabilidadPerdida
                  ? "positivo"
                  : "neutro"
              }
              detalle={`sin cobertura: ${porcentaje(sinCobertura.monteCarlo.probabilidadPerdida)}`}
            />
            <TarjetaMetrica
              etiqueta="Utilidad en el peor 5 %"
              valor={cop(recomendada.monteCarlo.percentiles.p5)}
              unidad="COP"
              tono={recomendada.monteCarlo.percentiles.p5 < 0 ? "negativo" : "positivo"}
              detalle={`sin cobertura: ${cop(sinCobertura.monteCarlo.percentiles.p5)} COP`}
            />
            <TarjetaMetrica
              etiqueta={`VaR 95 % ${esInventario ? "al embarque" : "a la entrega"}`}
              valor={cop(recomendada.var.varCop)}
              unidad="COP"
              detalle={`sin cobertura: ${cop(sinCobertura.var.varCop)} COP`}
            />
          </div>
        </section>
      ) : null}

      {/* --- Advertencias ----------------------------------------------- */}
      {resultados.advertencias.length > 0 || resultados.advertenciasDatos?.length > 0 ? (
        <section
          aria-labelledby="advertencias"
          className="rounded-lg border border-borde bg-superficie p-4"
        >
          <h2 id="advertencias" className="text-sm font-semibold">
            Advertencias
          </h2>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-texto-suave">
            {[...resultados.advertencias, ...(resultados.advertenciasDatos ?? [])].map(
              (aviso, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-ambar">
                    ▸
                  </span>
                  <span>{aviso}</span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {/* --- Informe narrativo ------------------------------------------- */}
      <InformeNarrativo
        analisisId={analisis.id}
        informe={analisis.informe_md}
        meta={
          analisis.informe_meta as unknown as {
            modelo?: string;
            generadoEn?: string;
            verificacion?: {
              totalCitadas: number;
              rastreables: number;
              limpio: boolean;
              sospechosas: { textual: string; contexto: string }[];
            };
          } | null
        }
      />

      {/* --- Tabla comparativa ------------------------------------------ */}
      <section aria-labelledby="estrategias" className="space-y-3">
        <h2 id="estrategias" className="text-sm font-semibold">
          Comparación de estrategias
        </h2>
        <TablaEstrategias
          evaluaciones={evaluaciones}
          idRecomendada={recomendacion.idEstrategia}
        />
      </section>

      {/* --- Gráficos ---------------------------------------------------- */}
      <SelectorEstrategia
        evaluaciones={evaluaciones}
        idInicial={recomendacion.idEstrategia}
        futuroActual={mercado.futuroUsdTm}
      />

      {/* --- Dimensionamiento -------------------------------------------- */}
      <section
        aria-labelledby="dimensionamiento"
        className="rounded-lg border border-borde bg-superficie p-4"
      >
        <h2 id="dimensionamiento" className="text-sm font-semibold">
          Dimensionamiento de la cobertura
        </h2>
        <p className="mt-1 text-xs text-texto-suave">
          {toneladas(resultados.dimensionamiento.toneladas)} TM equivalen a{" "}
          <span className="tabular">
            {resultados.dimensionamiento.contratosExactos.toLocaleString("es-CO", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>{" "}
          contratos CC, y un contrato no se puede partir.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* Cuando las toneladas caen justo en un múltiplo de 10 no hay dos
              alternativas: subcobertura y sobrecobertura son la misma, y
              pintarla dos veces haría creer que hay una decisión que tomar. */}
          {alternativasDimensionamiento.map((alternativa) => (
            <div key={alternativa.contratos} className="rounded border border-borde p-3">
              <p className="text-sm font-medium capitalize">{alternativa.tipo}</p>
              <p className="tabular mt-0.5 text-sm">
                {alternativa.contratos} contratos · {toneladas(alternativa.toneladasCubiertas)} TM
              </p>
              <p className="mt-1 text-xs text-texto-suave">{alternativa.exposicionResidual}</p>
            </div>
          ))}
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
