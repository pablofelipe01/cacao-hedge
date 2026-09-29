"use client";

import { useState } from "react";

import { Explicacion } from "@/components/Explicacion";
import { TarjetaMetrica } from "@/components/TarjetaMetrica";
import type { RespuestaSimulacion } from "@/lib/acciones/simulador";
import type { ResultadoPlan } from "@/lib/engine/simulador";
import { cop, fechaLegible, porcentaje, toneladas, usdTm } from "@/lib/formato";
import { GraficoCaja } from "./GraficoCaja";

type Exitosa = Extract<RespuestaSimulacion, { ok: true }>;

function Orden({ plan }: { plan: ResultadoPlan }) {
  if (plan.plan.tipo === "sin_cobertura") {
    return <p className="text-sm text-texto-suave">No se toma posición en bolsa.</p>;
  }
  // Por vencimiento: es como se le pide al bróker.
  const porVencimiento = new Map<string, { nombre: string; contratos: number; cierres: string[] }>();
  for (const c of plan.porEntrega) {
    if (c.contratos === 0) continue;
    const actual = porVencimiento.get(c.vencimiento.codigo) ?? { nombre: c.vencimiento.nombre, contratos: 0, cierres: [] };
    actual.contratos += c.contratos;
    actual.cierres.push(`${c.contratos} el ${fechaLegible(c.fechaCierre)}`);
    porVencimiento.set(c.vencimiento.codigo, actual);
  }
  const instrumento =
    plan.plan.tipo === "futuros"
      ? "contratos de futuro"
      : plan.plan.tipo === "call"
        ? `calls strike ${usdTm(plan.strikeUsdTm ?? 0)}`
        : `call spreads ${usdTm(plan.strikeUsdTm ?? 0)}/${usdTm(plan.techoUsdTm ?? 0)}`;

  return (
    <ul className="space-y-1.5 text-sm">
      {[...porVencimiento.entries()].map(([codigo, v]) => (
        <li key={codigo}>
          <span className="font-medium">Comprar {v.contratos} {instrumento}</span> de {v.nombre} ({codigo})
          <span className="block text-xs text-texto-suave">
            Se {plan.plan.tipo === "futuros" ? "venden" : "venden (o ejercen)"} al comprar el cacao de cada entrega: {v.cierres.join(" · ")}.
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Lo que devuelve el simulador, de lo más importante a lo más detallado. */
export function ResultadoSimulacion({ respuesta }: { respuesta: Exitosa }) {
  const { resultado: r, mercado } = respuesta;
  const [elegido, setElegido] = useState(r.recomendado);
  const plan = r.planes.find((p) => p.plan.id === elegido) ?? r.planes[0];
  const recomendado = r.planes.find((p) => p.plan.id === r.recomendado)!;

  return (
    <div className="space-y-8">
      <p className="tabular text-xs text-texto-suave">
        Futuro NY {usdTm(mercado.futuroUsdTm)} USD/TM · TRM {usdTm(mercado.trm, 2)} · datos del{" "}
        {fechaLegible(mercado.fechaDatos)} · {toneladas(r.toneladas)} TM en {r.entregas.length} entrega(s)
      </p>

      <section aria-labelledby="alPrecioHoy" className="grid gap-3 sm:grid-cols-3">
        <h2 id="alPrecioHoy" className="sr-only">Al precio de hoy</h2>
        <TarjetaMetrica
          etiqueta="Margen al precio de hoy"
          valor={usdTm(r.margenHoyUsdTm)}
          unidad="USD/TM"
          detalle={`${cop(r.utilidadHoyCop)} COP en toda la venta`}
        />
        <TarjetaMetrica
          etiqueta="NY de equilibrio"
          valor={r.equilibrioUsdTm != null ? usdTm(r.equilibrioUsdTm) : "—"}
          unidad="USD/TM"
          explica="nyEquilibrioVenta"
          detalle={
            r.equilibrioUsdTm != null
              ? `${porcentaje(r.equilibrioUsdTm / mercado.futuroUsdTm - 1)} desde hoy`
              : undefined
          }
        />
        <TarjetaMetrica
          etiqueta="Sin cubrir, en el peor 5 %"
          valor={cop(r.planes.find((p) => p.plan.tipo === "sin_cobertura")!.utilidad.p5Cop)}
          unidad="COP"
          explica="percentil5"
        />
      </section>

      <section aria-labelledby="sugerida" className="rounded-lg border border-cacao/30 bg-cacao/5 p-4">
        <h2 id="sugerida" className="text-sm font-semibold">
          Sugerida: {recomendado.plan.nombre}
        </h2>
        <p className="mt-1 text-sm leading-relaxed">{r.justificacion}</p>
        <div className="mt-3">
          <Orden plan={recomendado} />
        </div>
        <p className="mt-2 text-xs text-texto-suave">
          {recomendado.plan.tipo === "futuros"
            ? `Margen inicial que retendría el bróker: ${usdTm(recomendado.margenInicialUsd)} USD (${cop(recomendado.desembolsoHoyCop)} COP).`
            : recomendado.primaUsd > 0
              ? `Prima estimada: ${usdTm(recomendado.primaUsd)} USD (${cop(recomendado.desembolsoHoyCop)} COP), con volatilidad histórica. Pida la cotización real al bróker.`
              : null}
        </p>
      </section>

      <section aria-labelledby="comparacion" className="space-y-3">
        <h2 id="comparacion" className="text-sm font-semibold">Las seis alternativas</h2>
        <div className="overflow-x-auto rounded-lg border border-borde bg-superficie">
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">Utilidad y caja de cada estrategia de cobertura.</caption>
            <thead>
              <tr className="border-b border-borde text-xs text-texto-suave">
                <th scope="col" className="px-3 py-2 text-left font-medium">Estrategia</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Sale hoy</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Utilidad media</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Explicacion termino="percentil5">Peor 5 %</Explicacion>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Explicacion termino="llamadasCompra">Llamadas de margen</Explicacion>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Explicacion termino="cajaMinima">Caja en el peor momento</Explicacion>
                </th>
                <th scope="col" className="px-3 py-2 text-center font-medium">
                  <Explicacion termino="cabeEnCapital">¿Cabe?</Explicacion>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.planes.map((p) => {
                const activo = p.plan.id === plan.plan.id;
                return (
                  <tr
                    key={p.plan.id}
                    className={`border-b border-borde/60 align-top last:border-0 ${activo ? "bg-cacao/5" : ""}`}
                  >
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <button
                        type="button"
                        onClick={() => setElegido(p.plan.id)}
                        aria-pressed={activo}
                        className="text-left hover:text-cacao"
                      >
                        {p.plan.nombre}
                        {p.plan.id === r.recomendado ? (
                          <span className="ml-1.5 rounded bg-cacao px-1.5 py-0.5 text-[0.65rem] font-medium text-white">sugerida</span>
                        ) : null}
                      </button>
                      <span className="block text-xs font-normal text-texto-suave">
                        {p.contratos > 0 ? `${p.contratos} contratos` : "sin posición"}
                      </span>
                    </th>
                    <td className="tabular px-3 py-2 text-right">{p.desembolsoHoyCop > 0 ? cop(p.desembolsoHoyCop) : "—"}</td>
                    <td className="tabular px-3 py-2 text-right">{cop(p.utilidad.mediaCop)}</td>
                    <td className="tabular px-3 py-2 text-right">
                      <span className={p.utilidad.p5Cop < 0 ? "text-negativo" : undefined}>{cop(p.utilidad.p5Cop)}</span>
                      <span className="block text-xs text-texto-suave">
                        pierde en {porcentaje(p.utilidad.probabilidadPerdida, 0)}
                      </span>
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {p.llamadasMargenP95Cop > 0 ? cop(p.llamadasMargenP95Cop) : <span className="text-texto-suave">no tiene</span>}
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      <span className={p.cajaMinima.p5 < 0 ? "text-negativo" : undefined}>{cop(p.cajaMinima.p5)}</span>
                      <span className="block text-xs text-texto-suave">normal: {cop(p.cajaMinima.mediana)}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.cabeEnCapital ? (
                        <span className="text-positivo">sí</span>
                      ) : (
                        <span className="text-negativo">
                          no
                          <span className="block text-xs">falta en {porcentaje(p.probabilidadCajaNegativa, 0)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-borde px-3 py-2 text-xs leading-relaxed text-texto-suave">
            Cifras en COP sobre {r.trayectorias.toLocaleString("es-CO")} caminos simulados del precio y
            la TRM, los mismos para las seis. La caja cuenta anticipos, pagos al productor,
            logística, cobros contra documentos, margen, primas y llamadas. Toque una estrategia para
            ver su caja semana a semana.
          </p>
        </div>
      </section>

      <section aria-labelledby="caja" className="space-y-3">
        <h2 id="caja" className="text-sm font-semibold">Caja semana a semana · {plan.plan.nombre}</h2>
        <p className="max-w-prose text-xs text-texto-suave">{plan.plan.descripcion}</p>
        <GraficoCaja plan={plan} />
        {plan.plan.id !== r.recomendado ? (
          <div className="rounded-lg border border-borde bg-superficie p-4">
            <h3 className="mb-2 text-xs font-semibold text-texto-suave">Qué se le pide al bróker</h3>
            <Orden plan={plan} />
          </div>
        ) : null}
      </section>

      <details className="rounded-lg border border-borde bg-superficie px-4 py-3 text-sm">
        <summary className="cursor-pointer text-texto-suave hover:text-texto">
          Calendario de caja de la sugerida, si el precio se quedara quieto
        </summary>
        <p className="mt-2 text-xs text-texto-suave">
          No es un pronóstico: es el orden en que entra y sale la plata. El riesgo está en la tabla
          de arriba.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-borde text-xs text-texto-suave">
                <th scope="col" className="py-1.5 pr-3 text-left font-medium">Fecha</th>
                <th scope="col" className="py-1.5 pr-3 text-left font-medium">Concepto</th>
                <th scope="col" className="py-1.5 pr-3 text-right font-medium">Movimiento</th>
                <th scope="col" className="py-1.5 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {r.calendario.map((m, i) => (
                <tr key={i} className="border-b border-borde/40 last:border-0">
                  <td className="tabular py-1.5 pr-3 text-texto-suave">{fechaLegible(m.fecha)}</td>
                  <td className="py-1.5 pr-3">{m.concepto}</td>
                  <td className={`tabular py-1.5 pr-3 text-right ${m.montoCop < 0 ? "text-negativo" : ""}`}>
                    {m.montoCop > 0 ? "+" : ""}
                    {cop(m.montoCop)}
                  </td>
                  <td className={`tabular py-1.5 text-right ${m.saldoCop < 0 ? "font-medium text-negativo" : ""}`}>
                    {cop(m.saldoCop)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {r.advertencias.length > 0 || respuesta.advertenciasMercado.length > 0 ? (
        <section aria-labelledby="avisosSim" className="space-y-2">
          <h2 id="avisosSim" className="text-sm font-semibold">Avisos</h2>
          <ul className="space-y-1.5">
            {[...r.advertencias, ...respuesta.advertenciasMercado].map((a) => (
              <li key={a} className="border-l-2 border-ambar pl-3 text-sm leading-relaxed">{a}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
