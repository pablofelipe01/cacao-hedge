"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cop, copExacto, porcentaje } from "@/lib/formato";
import type { DistribucionMonteCarlo } from "@/lib/engine/montecarlo";

interface Props {
  distribucion: DistribucionMonteCarlo;
  nombreEstrategia: string;
}

/**
 * Distribución simulada de la utilidad.
 *
 * Las barras por debajo de cero van en rojo y las de arriba en azul: no
 * es decoración, es la misma escala divergente del heatmap aplicada al
 * umbral que decide el negocio. La probabilidad de pérdida deja de ser un
 * número en una tabla y pasa a ser el área roja que se ve de un vistazo.
 */
export function HistogramaMonteCarlo({ distribucion, nombreEstrategia }: Props) {
  const datos = distribucion.histograma.map((bin) => ({
    centro: bin.centro,
    cuenta: bin.cuenta,
    desde: bin.desde,
    hasta: bin.hasta,
    perdida: bin.centro < 0,
  }));

  return (
    <figure className="space-y-3">
      <figcaption className="space-y-1">
        <h3 className="text-sm font-semibold">
          Distribución Monte Carlo · {nombreEstrategia}
        </h3>
        <p className="text-xs text-texto-suave">
          {distribucion.trayectorias.toLocaleString("es-CO")} trayectorias simuladas con
          movimiento browniano geométrico y variables antitéticas. El eje horizontal es
          la utilidad final en pesos.
        </p>
      </figcaption>

      {/* Leyenda: con dos colores en juego, la identidad nunca puede
          depender solo del color. */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-neg-2)" }} />
          Pérdida · {porcentaje(distribucion.probabilidadPerdida)} de los casos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-pos-2)" }} />
          Ganancia
        </span>
        <span className="text-texto-suave">
          Percentil 5: <span className="tabular">{cop(distribucion.percentiles.p5)}</span> COP
        </span>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="var(--viz-rejilla)" vertical={false} />
            <XAxis
              dataKey="centro"
              // Un decimal y separación amplia: con cero decimales el eje
              // repetía la misma etiqueta en ticks de valor distinto.
              tickFormatter={(v: number) => cop(v, 1)}
              tick={{ fill: "var(--viz-tenue)", fontSize: 11 }}
              axisLine={{ stroke: "var(--viz-eje)" }}
              tickLine={false}
              minTickGap={44}
            />
            <YAxis
              tick={{ fill: "var(--viz-tenue)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              label={{
                value: "trayectorias",
                angle: -90,
                position: "insideLeft",
                style: { fill: "var(--viz-tenue)", fontSize: 11 },
              }}
            />
            <Tooltip
              cursor={{ fill: "var(--viz-rejilla)", opacity: 0.4 }}
              contentStyle={{
                background: "var(--superficie)",
                border: "1px solid var(--borde)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--texto)",
              }}
              labelFormatter={() => ""}
              formatter={(_valor, _nombre, item) => {
                const d = item.payload as (typeof datos)[number];
                return [
                  `${d.cuenta.toLocaleString("es-CO")} trayectorias entre ${copExacto(d.desde)} y ${copExacto(d.hasta)} COP`,
                  d.perdida ? "Pérdida" : "Ganancia",
                ];
              }}
            />
            {/* El umbral que decide el negocio: por debajo, el lote pierde plata. */}
            <ReferenceLine
              x={0}
              stroke="var(--texto-suave)"
              strokeWidth={1}
              label={{
                value: "punto de equilibrio",
                position: "top",
                style: { fill: "var(--texto-suave)", fontSize: 10 },
              }}
            />
            <Bar dataKey="cuenta" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {datos.map((d, i) => (
                <Cell
                  key={i}
                  fill={d.perdida ? "var(--viz-neg-2)" : "var(--viz-pos-2)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
