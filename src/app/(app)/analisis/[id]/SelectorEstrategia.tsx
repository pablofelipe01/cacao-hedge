"use client";

import { useMemo, useState } from "react";

import { HeatmapEscenarios } from "@/components/charts/HeatmapEscenarios";
import { HistogramaMonteCarlo } from "@/components/charts/HistogramaMonteCarlo";
import { PayoffEstrategias, type SeriePayoff } from "@/components/charts/PayoffEstrategias";
import { cop, usdTm } from "@/lib/formato";
import type { EvaluacionEstrategia } from "@/lib/engine/index";

interface Props {
  evaluaciones: EvaluacionEstrategia[];
  idInicial: string;
  futuroActual: number;
}

/**
 * Estrategias representadas en el perfil de resultado.
 *
 * Se limita a cuatro a propósito: la guía de visualización prohíbe pasar
 * de las categóricas validadas, y con nueve líneas encima el gráfico deja
 * de explicar la decisión. Estas cuatro cubren las formas distintas
 * —diagonal, plana, rodilla y meseta—; el resto vive en la tabla.
 */
const EN_PAYOFF = ["sin_cobertura", "futuros_100", "put_95", "collar"];

/**
 * Reconstruye la curva de payoff desde los escenarios guardados.
 *
 * El análisis persistido trae los 63 escenarios; los que mueven solo el
 * precio (TRM y base en cero) son exactamente un corte del perfil de
 * resultado, así que la curva sale de datos ya calculados sin recalcular
 * nada ni volver al servidor.
 */
function curvaDesdeEscenarios(evaluacion: EvaluacionEstrategia): SeriePayoff["puntos"] {
  return evaluacion.resumen.resultados
    .filter((r) => r.escenario.ejes.trm === 0 && r.escenario.ejes.base === 0)
    .map((r) => ({ futuro: r.escenario.futuroUsdTm, utilidad: r.utilidadCop }))
    .sort((a, b) => a.futuro - b.futuro);
}

export function SelectorEstrategia({ evaluaciones, idInicial, futuroActual }: Props) {
  const [id, setId] = useState(idInicial);

  const activa =
    evaluaciones.find((e) => e.resumen.estrategia.id === id) ?? evaluaciones[0];

  const series = useMemo<SeriePayoff[]>(
    () =>
      EN_PAYOFF.map((idEstrategia) =>
        evaluaciones.find((e) => e.resumen.estrategia.id === idEstrategia),
      )
        .filter((e): e is EvaluacionEstrategia => e !== undefined)
        .map((e) => ({
          id: e.resumen.estrategia.id,
          nombre: e.resumen.estrategia.nombre,
          puntos: curvaDesdeEscenarios(e),
        })),
    [evaluaciones],
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="payoff" className="rounded-lg border border-borde bg-superficie p-4">
        <h2 id="payoff" className="sr-only">Perfil de resultado</h2>
        <PayoffEstrategias series={series} futuroActual={futuroActual} />
      </section>

      <section aria-labelledby="detalle" className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="detalle" className="mr-2 text-sm font-semibold">
            Detalle por estrategia
          </h2>
          <label htmlFor="estrategia" className="sr-only">
            Estrategia a examinar
          </label>
          <select
            id="estrategia"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm outline-none focus:border-cacao"
          >
            {evaluaciones.map((e) => (
              <option key={e.resumen.estrategia.id} value={e.resumen.estrategia.id}>
                {e.resumen.estrategia.nombre}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs leading-relaxed text-texto-suave">
          {activa.resumen.estrategia.descripcion}
        </p>

        <div className="rounded-lg border border-borde bg-superficie p-4">
          <HeatmapEscenarios
            resultados={activa.resumen.resultados}
            nombreEstrategia={activa.resumen.estrategia.nombre}
          />
        </div>

        <div className="rounded-lg border border-borde bg-superficie p-4">
          <HistogramaMonteCarlo
            distribucion={activa.monteCarlo}
            nombreEstrategia={activa.resumen.estrategia.nombre}
          />
        </div>

        {activa.margen ? (
          <div className="rounded-lg border border-borde bg-superficie p-4">
            <h3 className="text-sm font-semibold">Riesgo de liquidez: llamadas de margen</h3>
            <p className="mt-1 text-xs leading-relaxed text-texto-suave">
              {activa.resumen.estrategia.sentido === "larga"
                ? "Estar comprado en futuros hace perder cuando el precio baja. Esa pérdida no es económica —el cacao que tiene que comprar baja al mismo tiempo— pero sí es un desembolso de caja inmediato contra la cámara de compensación."
                : "Estar corto en futuros hace perder cuando el precio sube. Esa pérdida no es económica —el cacao en bodega sube al mismo tiempo— pero sí es un desembolso de caja inmediato contra la cámara de compensación."}
            </p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-texto-suave">Capital inmovilizado</dt>
                <dd className="tabular font-medium">
                  {cop(activa.margen.margenInicialTotalCop)} COP
                </dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">
                  Primera llamada si el futuro{" "}
                  {activa.resumen.estrategia.sentido === "larga" ? "baja" : "sube"} a
                </dt>
                <dd className="tabular font-medium">
                  {usdTm(activa.margen.precioDisparadorUsdTm)} USD/TM
                </dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Peor llamada de la matriz</dt>
                <dd className="tabular font-medium">
                  {activa.margen.peorLlamada
                    ? `${cop(activa.margen.peorLlamada.montoCop)} COP`
                    : "sin llamadas"}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>
    </div>
  );
}
