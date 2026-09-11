"use client";

import { useMemo } from "react";
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

import { cop, usdTm } from "@/lib/formato";

export interface SeriePayoff {
  id: string;
  nombre: string;
  /** Utilidad en COP para cada precio del futuro. */
  puntos: { futuro: number; utilidad: number }[];
}

interface Props {
  series: SeriePayoff[];
  futuroActual: number;
}

/**
 * Colores categóricos en orden fijo. El color sigue a la estrategia, no a
 * su posición en un ranking: si el usuario filtra, las supervivientes
 * conservan su tono y nadie tiene que reaprender la leyenda.
 */
const COLORES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"];

/**
 * Perfil de resultado de cada estrategia frente al precio del futuro.
 *
 * Es el gráfico que explica la decisión de un vistazo: la línea sin
 * cobertura es una diagonal, la de futuros es plana, la del put es una
 * rodilla y la del collar una meseta entre dos codos.
 */
export function PayoffEstrategias({ series, futuroActual }: Props) {
  // Recharts necesita una fila por punto del eje X con una columna por
  // serie, así que se cruzan las series sobre la rejilla de precios.
  const datos = useMemo(() => {
    const precios = [...new Set(series.flatMap((s) => s.puntos.map((p) => p.futuro)))].sort(
      (a, b) => a - b,
    );

    return precios.map((futuro) => {
      const fila: Record<string, number> = { futuro };
      for (const serie of series) {
        const punto = serie.puntos.find((p) => p.futuro === futuro);
        if (punto) fila[serie.id] = punto.utilidad;
      }
      return fila;
    });
  }, [series]);

  return (
    <figure className="space-y-3">
      <figcaption className="space-y-1">
        <h3 className="text-sm font-semibold">Perfil de resultado</h3>
        <p className="text-xs text-texto-suave">
          Utilidad en pesos según dónde termine el futuro CC en la fecha de embarque,
          manteniendo el diferencial y la TRM en su valor esperado.
        </p>
      </figcaption>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((serie, i) => (
          <span key={serie.id} className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ background: COLORES[i % COLORES.length] }}
            />
            {serie.nombre}
          </span>
        ))}
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={datos} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--viz-rejilla)" />
            <XAxis
              dataKey="futuro"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => usdTm(v)}
              tick={{ fill: "var(--viz-tenue)", fontSize: 11 }}
              axisLine={{ stroke: "var(--viz-eje)" }}
              tickLine={false}
              label={{
                value: "futuro CC en el embarque (USD/TM)",
                position: "insideBottom",
                offset: -2,
                style: { fill: "var(--viz-tenue)", fontSize: 11 },
              }}
              height={42}
            />
            <YAxis
              tickFormatter={(v: number) => cop(v, 1)}
              tick={{ fill: "var(--viz-tenue)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              contentStyle={{
                background: "var(--superficie)",
                border: "1px solid var(--borde)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--texto)",
              }}
              labelFormatter={(etiqueta) => `Futuro a ${usdTm(Number(etiqueta))} USD/TM`}
              formatter={(valor, id) => [
                `${cop(Number(valor))} COP`,
                series.find((s) => s.id === id)?.nombre ?? String(id),
              ]}
            />
            {/* Cero: por debajo el lote pierde plata. */}
            <ReferenceLine y={0} stroke="var(--viz-eje)" strokeWidth={1} />
            {/* El precio de hoy, para ubicar dónde se está parado. */}
            <ReferenceLine
              x={futuroActual}
              stroke="var(--texto-suave)"
              strokeWidth={1}
              label={{
                value: "hoy",
                position: "top",
                style: { fill: "var(--texto-suave)", fontSize: 10 },
              }}
            />
            {series.map((serie, i) => (
              <Line
                key={serie.id}
                type="monotone"
                dataKey={serie.id}
                stroke={COLORES[i % COLORES.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--superficie)" }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
