"use client";

import { useMemo, useState } from "react";

import { cop, copExacto, porcentaje, usdTm } from "@/lib/formato";
import type { ResultadoEscenario } from "@/lib/engine/tipos";
import {
  PASOS_ESCALA,
  colorDivergente,
  extremoAbsoluto,
  tintaSobre,
} from "./escalaDivergente";

interface Props {
  resultados: ResultadoEscenario[];
  nombreEstrategia: string;
}

/** Desviaciones de base presentes en la matriz, en USD/TM. */
function ejesDe(resultados: ResultadoEscenario[]) {
  const unico = (valores: number[]) => [...new Set(valores)].sort((a, b) => a - b);
  return {
    precios: unico(resultados.map((r) => r.escenario.ejes.precio)),
    trms: unico(resultados.map((r) => r.escenario.ejes.trm)),
    bases: unico(resultados.map((r) => r.escenario.ejes.base)),
  };
}

/**
 * Matriz de escenarios como rejilla.
 *
 * Los tres ejes no caben en un plano, así que la base se elige con un
 * control y la rejilla muestra precio × TRM. Separar la base en su propio
 * selector no es una concesión: es lo que deja ver que moverla desplaza
 * toda la matriz aun con la cobertura puesta, que es el punto del riesgo
 * de base.
 */
export function HeatmapEscenarios({ resultados, nombreEstrategia }: Props) {
  const { precios, trms, bases } = useMemo(() => ejesDe(resultados), [resultados]);
  const [base, setBase] = useState(() => (bases.includes(0) ? 0 : bases[0]));
  const [activa, setActiva] = useState<ResultadoEscenario | null>(null);

  // La escala se fija con TODA la matriz, no solo con la base visible: si
  // cambiara al mover el selector, los colores no serían comparables
  // entre cortes y el gráfico mentiría.
  const extremo = useMemo(
    () => extremoAbsoluto(resultados.map((r) => r.utilidadCop)),
    [resultados],
  );

  const celda = (precio: number, trm: number) =>
    resultados.find(
      (r) =>
        r.escenario.ejes.precio === precio &&
        r.escenario.ejes.trm === trm &&
        r.escenario.ejes.base === base,
    );

  return (
    <figure className="space-y-3">
      <figcaption className="space-y-1">
        <h3 className="text-sm font-semibold">Matriz de escenarios · {nombreEstrategia}</h3>
        <p className="text-xs text-texto-suave">
          Utilidad en pesos según el movimiento del futuro CC (filas) y de la TRM
          (columnas). El color divergente marca pérdida y ganancia con el cero en el
          centro.
        </p>
      </figcaption>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-texto-suave">Diferencial (base):</span>
        {bases.map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => setBase(valor)}
            aria-pressed={base === valor}
            className={`rounded border px-2 py-1 transition ${
              base === valor
                ? "border-cacao bg-cacao font-medium text-white"
                : "border-borde text-texto-suave hover:text-texto"
            }`}
          >
            {valor > 0 ? "+" : ""}
            {valor} USD/TM
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-[2px] text-xs">
          <caption className="sr-only">
            Utilidad en pesos por escenario de precio y tasa de cambio, con diferencial{" "}
            {base} USD por tonelada.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium text-texto-suave">
                Futuro \ TRM
              </th>
              {trms.map((trm) => (
                <th
                  key={trm}
                  scope="col"
                  className="px-2 py-1 text-center font-medium text-texto-suave"
                >
                  {porcentaje(trm, 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...precios].reverse().map((precio) => (
              <tr key={precio}>
                <th
                  scope="row"
                  className="tabular px-2 py-1 text-right font-medium text-texto-suave"
                >
                  {porcentaje(precio, 0)}
                </th>
                {trms.map((trm) => {
                  const dato = celda(precio, trm);
                  if (!dato) return <td key={trm} />;

                  return (
                    <td key={trm} className="p-0">
                      <button
                        type="button"
                        onMouseEnter={() => setActiva(dato)}
                        onFocus={() => setActiva(dato)}
                        onMouseLeave={() => setActiva(null)}
                        onBlur={() => setActiva(null)}
                        className="tabular block w-full rounded px-2 py-2 text-center tracking-tight outline-offset-2"
                        style={{
                          background: colorDivergente(dato.utilidadCop, extremo),
                          color: tintaSobre(dato.utilidadCop, extremo),
                        }}
                        title={`Futuro ${porcentaje(precio, 0)}, TRM ${porcentaje(trm, 0)}: ${copExacto(dato.utilidadCop)} COP`}
                      >
                        {cop(dato.utilidadCop, 0)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Leyenda de la escala: sin ella el color no significa nada. */}
      <div className="flex items-center gap-2 text-xs text-texto-suave">
        <span>Pérdida</span>
        <div className="flex">
          {PASOS_ESCALA.map((paso) => (
            <span
              key={paso}
              className="h-3 w-6 first:rounded-l last:rounded-r"
              style={{ background: paso }}
            />
          ))}
        </div>
        <span>Ganancia</span>
        <span className="ml-auto tabular">
          {activa
            ? `${activa.escenario.etiqueta}: ${copExacto(activa.utilidadCop)} COP · precio efectivo ${usdTm(activa.precioFisicoUsdTm)} USD/TM`
            : "Pase el cursor sobre una celda para ver el detalle"}
        </span>
      </div>
    </figure>
  );
}
