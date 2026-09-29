"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ResultadoPlan } from "@/lib/engine/simulador";
import { cop, fechaLegible } from "@/lib/formato";

/**
 * La caja de una estrategia, semana a semana.
 *
 * Dos líneas: la de un camino normal (la mediana) y la del peor 5 %. La
 * línea de cero es el límite del capital: si la del peor 5 % la cruza, en
 * esos caminos la operación necesita plata que no hay.
 */
export function GraficoCaja({ plan }: { plan: ResultadoPlan }) {
  const datos = plan.caja.map((c) => ({ ...c, etiqueta: fechaLegible(c.fecha) }));

  return (
    <figure className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: "var(--viz-1)" }} />
          Camino normal (mediana)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: "var(--viz-neg-2)" }} />
          Peor 5 %
        </span>
        <span className="text-texto-suave">La línea de cero es donde se acaba el capital.</span>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--viz-rejilla)" vertical={false} />
            <XAxis
              dataKey="etiqueta"
              tick={{ fill: "var(--viz-tenue)", fontSize: 11 }}
              axisLine={{ stroke: "var(--viz-eje)" }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={(v: number) => cop(v, 0)}
              tick={{ fill: "var(--viz-tenue)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={{
                background: "var(--superficie)",
                border: "1px solid var(--borde)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--texto)",
              }}
              formatter={(valor, nombre) => [`${cop(Number(valor))} COP`, nombre === "mediana" ? "Camino normal" : "Peor 5 %"]}
            />
            <ReferenceLine y={0} stroke="var(--texto-suave)" strokeWidth={1} />
            <Line type="monotone" dataKey="mediana" stroke="var(--viz-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="p5"
              stroke="var(--viz-neg-2)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-texto-suave">
        Saldo de caja al cierre de cada semana, en pesos. El peor 5 % de cada semana no es un solo
        camino: es el nivel por debajo del cual cae la caja en uno de cada veinte.
      </figcaption>
    </figure>
  );
}
