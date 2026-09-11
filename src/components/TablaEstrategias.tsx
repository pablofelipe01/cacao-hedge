import { cop, porcentaje, usdTm } from "@/lib/formato";
import type { EvaluacionEstrategia } from "@/lib/engine/index";

interface Props {
  evaluaciones: EvaluacionEstrategia[];
  idRecomendada: string;
}

/**
 * Tabla comparativa de estrategias.
 *
 * Además de ser lo que pide el análisis, cumple la regla de relieve de la
 * guía de visualización: dos de los colores categóricos quedan por debajo
 * de 3:1 sobre la superficie clara, así que toda cifra que aparece en un
 * gráfico tiene que ser legible también aquí, sin depender del color.
 */
export function TablaEstrategias({ evaluaciones, idRecomendada }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-borde bg-superficie">
      <table className="w-full min-w-[760px] text-sm">
        <caption className="sr-only">
          Comparación de estrategias de cobertura por utilidad, riesgo y costo.
        </caption>
        <thead>
          <tr className="border-b border-borde text-xs text-texto-suave">
            <th scope="col" className="px-3 py-2 text-left font-medium">Estrategia</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Contratos</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Caso base</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Peor caso</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Mejor caso</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Percentil 5</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">P(pérdida)</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">VaR 95 %</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Costo inicial</th>
          </tr>
        </thead>
        <tbody>
          {evaluaciones.map((evaluacion) => {
            const { estrategia, peorCaso, mejorCaso, casoBase } = evaluacion.resumen;
            const esRecomendada = estrategia.id === idRecomendada;

            return (
              <tr
                key={estrategia.id}
                className={`border-b border-borde/60 last:border-0 ${
                  esRecomendada ? "bg-ambar/10" : ""
                }`}
              >
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <span className="font-medium">{estrategia.nombre}</span>
                  {esRecomendada ? (
                    <span className="ml-2 rounded bg-ambar/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ambar">
                      recomendada
                    </span>
                  ) : null}
                </th>
                <td className="tabular px-3 py-2 text-right">
                  {estrategia.contratos || "—"}
                </td>
                <td className="tabular px-3 py-2 text-right">{cop(casoBase.utilidadCop)}</td>
                <td
                  className={`tabular px-3 py-2 text-right ${
                    peorCaso.utilidadCop < 0 ? "text-negativo" : ""
                  }`}
                >
                  {cop(peorCaso.utilidadCop)}
                </td>
                <td className="tabular px-3 py-2 text-right">{cop(mejorCaso.utilidadCop)}</td>
                <td
                  className={`tabular px-3 py-2 text-right ${
                    evaluacion.monteCarlo.percentiles.p5 < 0 ? "text-negativo" : ""
                  }`}
                >
                  {cop(evaluacion.monteCarlo.percentiles.p5)}
                </td>
                <td className="tabular px-3 py-2 text-right">
                  {porcentaje(evaluacion.monteCarlo.probabilidadPerdida)}
                </td>
                <td className="tabular px-3 py-2 text-right">{cop(evaluacion.var.varCop)}</td>
                <td className="tabular px-3 py-2 text-right">
                  {estrategia.costoInicialUsd === 0
                    ? "—"
                    : `${usdTm(estrategia.costoInicialUsd)} USD`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-borde px-3 py-2 text-xs text-texto-suave">
        Cifras en pesos, abreviadas (M = millones). «Caso base» es el escenario sin
        cambios; «peor» y «mejor» son los extremos de los 63 escenarios de la matriz.
        El percentil 5 y la probabilidad de pérdida vienen de la simulación Monte Carlo.
      </p>
    </div>
  );
}
