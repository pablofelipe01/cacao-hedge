import Link from "next/link";

import { CLASES_INPUT } from "@/components/Campo";
import { Disclaimer } from "@/components/Disclaimer";
import { Explicacion } from "@/components/Explicacion";
import { TarjetaMetrica } from "@/components/TarjetaMetrica";
import { supuestosDelUsuario } from "@/lib/acciones/supuestos-usuario";
import { descuentoVigente } from "@/lib/data/descuento-productor";
import { ErrorDatos } from "@/lib/data/errores";
import { elegirProveedor, obtenerMercado } from "@/lib/data/mercado";
import { ventaDesdeFila } from "@/lib/data/ventas";
import {
  analizarPosicion,
  type Diferencial,
  type MesPosicion,
  type RiesgoResumido,
} from "@/lib/engine/consolidado";
import { envDatosMercado, hayClaveServiceRole } from "@/lib/env";
import { cop, fechaLegible, porcentaje, toneladas, usdTm } from "@/lib/formato";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { interpretarNumero } from "@/lib/acciones/esquemas";
import { redirect } from "next/navigation";

/** Sale a la red por el precio y la TRM: el arranque en frío puede tardar. */
export const maxDuration = 30;

/**
 * Descuento de compra cuando no hay precios del productor sincronizados.
 *
 * Es la media de dos años de datos de Nacional y Luker contra NY, medida
 * el 2026-09-11. Solo es un respaldo: con la hoja sincronizada se usa lo
 * medido.
 */
const DESCUENTO_COMPRA_RESPALDO = -0.23;

/** Días hasta la venta del cacao sin comprador, si el usuario no dice otra cosa. */
const DIAS_VENTA_LIBRE = 90;

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function parametro(valor: string | string[] | undefined): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

function tmConSigno(valor: number): string {
  const redondeado = Math.round(valor * 10) / 10;
  if (redondeado === 0) return "0";
  return `${redondeado > 0 ? "+" : "−"}${toneladas(Math.abs(redondeado))}`;
}

function leerExposicion(valor: number): string {
  if (Math.abs(valor) < 0.05) return "sin riesgo de precio";
  return valor > 0 ? "gana si sube" : "pierde si sube";
}

function Riesgo({ r }: { r: RiesgoResumido }) {
  return (
    <>
      <span className={r.p5Cop < 0 ? "text-negativo" : undefined}>{cop(r.p5Cop)}</span>
      <span className="block text-xs text-texto-suave">
        pérdida en {porcentaje(r.probabilidadPerdida, 0)} de los casos
      </span>
    </>
  );
}

function Cobertura({ mes }: { mes: MesPosicion }) {
  if (!mes.cobertura) {
    return (
      <span className="text-texto-suave">
        {Math.abs(mes.exposicionTm) < 0.05 ? "nada que cubrir" : "no alcanza un contrato"}
      </span>
    );
  }
  const { sentido, contratos, vencimiento } = mes.cobertura;
  return (
    <>
      <span className="font-medium">
        {sentido === "corta" ? "Vender" : "Comprar"} {contratos}
      </span>{" "}
      {vencimiento.codigo}
    </>
  );
}

/**
 * La posición de toda la empresa, mes a mes.
 *
 * Junta las tres cubetas que el cliente describió —lo comprado, lo
 * vendido a precio cerrado y lo comprometido por fijar— y dice, para cada
 * mes de embarque, cuánto queda expuesto a Nueva York y con qué contrato
 * se cubre.
 */
export default async function PaginaPosicion({ searchParams }: PageProps<"/posicion">) {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const params = await searchParams;
  const supabase = await crearClienteServidor();
  const hoy = new Date().toISOString().slice(0, 10);

  const [{ data: bodega }, { data: filasVentas }, { supuestos: supuestosBase, volRespaldo }, descuento] =
    await Promise.all([
      supabase.from("inventario_bodega").select("cantidad_disponible_kg, valor_compra_cop_kg"),
      supabase.from("ventas").select("*").eq("activo", true).order("fecha_embarque"),
      supuestosDelUsuario(usuario.id),
      descuentoVigente(supabase, usuario.id).catch(() => null),
    ]);

  // --- Bodega: toneladas y costo ponderado sobre lo que declara costo --
  const filasBodega = bodega ?? [];
  const kg = filasBodega.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const conCosto = filasBodega.filter((f) => f.valor_compra_cop_kg != null);
  const kgConCosto = conCosto.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const costoCopKg =
    kgConCosto > 0
      ? conCosto.reduce((a, f) => a + Number(f.valor_compra_cop_kg) * Number(f.cantidad_disponible_kg), 0) /
        kgConCosto
      : null;

  const ventas = (filasVentas ?? []).map(ventaDesdeFila);

  // --- Supuestos de esta vista, editables desde el pie ----------------
  //
  // El descuento de compra por defecto es la mediana medida y no el de
  // hoy: la compra ocurrirá dentro de meses, y el descuento revierte a su
  // media. El de hoy es la mejor estimación para comprar HOY.
  const compraMedida = descuento?.resumen.mediana ?? null;
  const compraPct = interpretarNumero(parametro(params.compra) ?? "");
  const diferencialCompra: Diferencial = {
    tipo: "fraccion",
    valor: Number.isFinite(compraPct) ? compraPct / 100 : (compraMedida ?? DESCUENTO_COMPRA_RESPALDO),
  };
  const librePct = interpretarNumero(parametro(params.libre) ?? "");
  const diferencialVentaLibre: Diferencial = {
    tipo: "fraccion",
    valor: Number.isFinite(librePct) ? librePct / 100 : 0,
  };
  const fechaLibreParam = parametro(params.fechaLibre);
  const fechaVentaLibre =
    fechaLibreParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaLibreParam) && fechaLibreParam > hoy
      ? fechaLibreParam
      : sumarDias(hoy, DIAS_VENTA_LIBRE);

  const supuestos =
    descuento && descuento.resumen.desviacion > 0
      ? { ...supuestosBase, desviacionBaseFraccion: descuento.resumen.desviacion }
      : supuestosBase;

  if (kg === 0 && ventas.length === 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Posición de la empresa</h1>
        <p className="rounded-md border border-dashed border-borde px-3 py-6 text-center text-sm text-texto-suave">
          No hay inventario en bodega ni ventas registradas. Sincronice la hoja en{" "}
          <Link href="/dashboard" className="text-cacao hover:underline">Inventario</Link> o registre
          una venta en <Link href="/ventas" className="text-cacao hover:underline">Ventas</Link>.
        </p>
      </div>
    );
  }

  let mercado;
  try {
    const { barchartApiKey, trmEndpoint, socrataAppToken } = envDatosMercado();
    mercado = await obtenerMercado({
      cliente: supabase,
      clienteAdmin: hayClaveServiceRole() ? crearClienteAdmin() : undefined,
      proveedor: elegirProveedor(barchartApiKey),
      opcionesTrm: { endpoint: trmEndpoint, appToken: socrataAppToken },
      volCacaoRespaldo: volRespaldo,
    });
  } catch (error) {
    return (
      <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
        {error instanceof ErrorDatos ? error.mensajeUsuario : "No se pudieron obtener los datos de mercado."}
      </p>
    );
  }

  const r = analizarPosicion(
    {
      hoy,
      inventario: { toneladas: kg / 1000, costoCopKg },
      ventas,
      diferencialCompra,
      diferencialVentaLibre,
      fechaVentaLibre,
    },
    mercado.mercado,
    supuestos,
  );
  const t = r.totales;
  const F0 = mercado.mercado.futuroUsdTm;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Posición de la empresa</h1>
            <p className="text-sm text-texto-suave">
              La bodega y las ventas juntas, mes a mes. Lo que se compensa entre ellas no hace
              falta cubrirlo.
            </p>
          </div>
          <Link
            href="/ventas"
            className="rounded-md border border-borde px-3 py-1.5 text-sm transition hover:border-cacao"
          >
            Registrar una venta
          </Link>
        </div>
        <p className="tabular text-xs text-texto-suave">
          Futuro NY {usdTm(F0)} USD/TM · TRM {usdTm(mercado.mercado.trm, 2)} · datos del{" "}
          {fechaLegible(mercado.mercado.fechaDatos)}
        </p>
      </header>

      {/* --- Las tres cubetas ------------------------------------------ */}
      <section aria-labelledby="cubetas">
        <h2 id="cubetas" className="sr-only">Qué tiene y qué debe</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TarjetaMetrica
            etiqueta="Comprado, en bodega"
            valor={toneladas(Math.round(t.toneladasBodega * 10) / 10)}
            unidad="TM"
            detalle={t.sinVender > 0 ? `${toneladas(Math.round(t.sinVender * 10) / 10)} TM aún sin venta` : "todo tiene venta"}
          />
          <TarjetaMetrica
            etiqueta="Vendido a precio cerrado"
            valor={toneladas(t.precioPactado)}
            unidad="TM"
          />
          <TarjetaMetrica
            etiqueta="Vendido por fijar contra NY"
            valor={toneladas(t.porFijar)}
            unidad="TM"
          />
          <TarjetaMetrica
            etiqueta="Falta comprar"
            valor={toneladas(Math.round(t.porComprar * 10) / 10)}
            unidad="TM"
            explica="asignacionBodega"
            detalle={`al ${porcentaje(diferencialCompra.valor)} de NY`}
          />
        </div>
      </section>

      {/* --- Lo que se le pide al bróker hoy --------------------------- */}
      <section aria-labelledby="ordenes" className="rounded-lg border border-cacao/30 bg-cacao/5 p-4">
        <h2 id="ordenes" className="text-sm font-semibold">Cobertura sugerida hoy</h2>
        {r.ordenes.length === 0 ? (
          <p className="mt-1 text-sm text-texto-suave">
            Ningún vencimiento necesita contratos: lo que tiene y lo que debe se compensan, o la
            exposición no llega a medio contrato.
          </p>
        ) : (
          <>
            <ul className="mt-2 space-y-1 text-sm">
              {r.ordenes.map((o) => (
                <li key={o.vencimiento.codigo}>
                  <span className="font-medium">
                    {o.sentido === "corta" ? "Vender" : "Comprar"} {o.contratos} contrato(s)
                  </span>{" "}
                  de {o.vencimiento.nombre} ({o.vencimiento.codigo})
                  <span className="text-texto-suave"> · primer aviso {fechaLegible(o.vencimiento.primerAviso)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-texto-suave">
              Margen inicial que retendría el bróker: {usdTm(t.margenInicialUsd)} USD (
              {cop(t.margenInicialCop)} COP). Cada cobertura se cierra cuando se fija el precio del
              físico de ese mes; si dos meses comparten vencimiento, al cerrar el primero se ajusta
              la posición del segundo.
            </p>
          </>
        )}
      </section>

      {/* --- Mes a mes --------------------------------------------------- */}
      <section aria-labelledby="meses" className="space-y-3">
        <h2 id="meses" className="text-sm font-semibold">Mes a mes</h2>
        <div className="overflow-x-auto rounded-lg border border-borde bg-superficie">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">
              Exposición a Nueva York, cobertura y riesgo por mes de embarque.
            </caption>
            <thead>
              <tr className="border-b border-borde text-xs text-texto-suave">
                <th scope="col" className="px-3 py-2 text-left font-medium">Mes</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Vendido</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Explicacion termino="asignacionBodega">De bodega / por comprar</Explicacion>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Explicacion termino="exposicionNeta">Exposición neta</Explicacion>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Si NY sube 10 %</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  <Explicacion termino="vencimientoMes">Cobertura</Explicacion>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  <Explicacion termino="percentil5">Mal día sin cubrir</Explicacion>
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Mal día cubierto</th>
              </tr>
            </thead>
            <tbody>
              {r.meses.map((m) => (
                <tr key={m.clave} className="border-b border-borde/60 align-top last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {m.etiqueta}
                    <span className="block text-xs font-normal text-texto-suave">
                      {m.partidas.map((p) => p.comprador).join(", ")}
                    </span>
                  </th>
                  <td className="tabular px-3 py-2 text-right">
                    {m.toneladas.precioPactado > 0 ? (
                      <span className="block">{toneladas(m.toneladas.precioPactado)} cerrado</span>
                    ) : null}
                    {m.toneladas.porFijar > 0 ? (
                      <span className="block">{toneladas(m.toneladas.porFijar)} por fijar</span>
                    ) : null}
                    {m.toneladas.sinVender > 0 ? (
                      <span className="block text-texto-suave">
                        {toneladas(Math.round(m.toneladas.sinVender * 10) / 10)} sin vender
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {toneladas(Math.round(m.toneladas.deBodega * 10) / 10)} /{" "}
                    <span className={m.toneladas.porComprar > 0 ? "font-medium" : "text-texto-suave"}>
                      {toneladas(Math.round(m.toneladas.porComprar * 10) / 10)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {tmConSigno(m.exposicionTm)} TM
                    <span className="block text-xs text-texto-suave">{leerExposicion(m.exposicionTm)}</span>
                  </td>
                  <td
                    className={`tabular px-3 py-2 text-right ${m.sensibilidad10Cop < 0 ? "text-negativo" : ""}`}
                  >
                    {Math.abs(m.sensibilidad10Cop) < 1 ? "—" : `${m.sensibilidad10Cop > 0 ? "+" : ""}${cop(m.sensibilidad10Cop)}`}
                  </td>
                  <td className="px-3 py-2">
                    <Cobertura mes={m} />
                    <span className="block text-xs text-texto-suave">{m.vencimiento.nombre}</span>
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    <Riesgo r={m.sinCubrir} />
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {m.cobertura ? <Riesgo r={m.cubierto} /> : <span className="text-texto-suave">igual</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-borde bg-fondo/50">
                <th scope="row" className="px-3 py-2 text-left font-semibold">
                  <Explicacion termino="malDiaTotal">Total</Explicacion>
                </th>
                <td className="tabular px-3 py-2 text-right">{toneladas(t.toneladasVendidas)}</td>
                <td className="tabular px-3 py-2 text-right">
                  {toneladas(Math.round((t.toneladasBodega - t.sinVender) * 10) / 10)} /{" "}
                  {toneladas(Math.round(t.porComprar * 10) / 10)}
                </td>
                <td className="tabular px-3 py-2 text-right">{tmConSigno(t.exposicionTm)} TM</td>
                <td className="tabular px-3 py-2 text-right">
                  {cop(t.exposicionTm * F0 * 0.1 * mercado.mercado.trm)}
                </td>
                <td className="px-3 py-2 text-texto-suave">
                  {t.contratosVender + t.contratosComprar} contrato(s)
                </td>
                <td className="tabular px-3 py-2 text-right font-medium">
                  <Riesgo r={t.sinCubrir} />
                </td>
                <td className="tabular px-3 py-2 text-right font-medium">
                  <Riesgo r={t.cubierto} />
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="border-t border-borde px-3 py-2 text-xs leading-relaxed text-texto-suave">
            «Mal día» es la utilidad del mes en el peor 5 % de {r.trayectorias.toLocaleString("es-CO")}{" "}
            caminos simulados del precio y la TRM, descontando lo que costó el cacao de bodega. El
            total no es la suma de los meses: se simulan todos sobre el mismo camino, y lo que un
            mes pierde cuando el cacao sube otro lo gana.
          </p>
        </div>
      </section>

      {r.advertencias.length > 0 || mercado.advertencias.length > 0 ? (
        <section aria-labelledby="avisos" className="space-y-2">
          <h2 id="avisos" className="text-sm font-semibold">Avisos</h2>
          <ul className="space-y-1.5">
            {[...r.advertencias, ...mercado.advertencias].map((a) => (
              <li key={a} className="border-l-2 border-ambar pl-3 text-sm leading-relaxed">
                {a}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* --- Supuestos de esta vista ------------------------------------ */}
      <details className="rounded-lg border border-borde bg-superficie px-4 py-3 text-sm">
        <summary className="cursor-pointer text-texto-suave hover:text-texto">
          Supuestos de esta vista
        </summary>
        <form method="get" className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="block text-sm font-medium">Descuento de compra (% de NY)</span>
            <input
              name="compra"
              inputMode="text"
              defaultValue={(diferencialCompra.valor * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })}
              className={CLASES_INPUT}
            />
            <span className="block text-xs text-texto-suave">
              {compraMedida != null
                ? `El habitual medido es ${porcentaje(compraMedida)}.`
                : "Sin precios del productor sincronizados: se usa −23 %."}
            </span>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">Diferencial del cacao sin venta (% de NY)</span>
            <input
              name="libre"
              inputMode="text"
              defaultValue={(diferencialVentaLibre.valor * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })}
              className={CLASES_INPUT}
            />
            <span className="block text-xs text-texto-suave">Al que espera venderlo.</span>
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">Cuándo espera venderlo</span>
            <input name="fechaLibre" type="date" defaultValue={fechaVentaLibre} className={CLASES_INPUT} />
            <span className="block text-xs text-texto-suave">Decide en qué mes cuenta.</span>
          </label>
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro"
            >
              Recalcular
            </button>
          </div>
        </form>
      </details>

      <Disclaimer />
    </div>
  );
}
