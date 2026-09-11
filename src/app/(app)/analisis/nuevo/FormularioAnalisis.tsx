"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { ejecutarAnalisis } from "@/lib/acciones/analisis";
import type { EstadoFormulario } from "@/lib/acciones/inventario";
import type { SerieDisponible } from "@/lib/data/cache";
import { CC_TONELADAS_POR_CONTRATO } from "@/lib/engine/constantes";
import { toneladas as fmtToneladas, usdTm } from "@/lib/formato";

interface Lote {
  id: string;
  nombre: string;
  toneladas: number;
  costo_cop_kg: number;
  fecha_embarque: string;
  diferencial_usd_tm: number;
  tipo_contrato: string;
  precio_venta_usd_tm: number | null;
}

interface Bodega {
  lotes: number;
  toneladas: number;
  costoCopKg: number | null;
  kgConCostoPorcentaje: number;
}

interface Props {
  lotes: Lote[];
  loteInicial: string | null;
  series: SerieDisponible[];
  bodega: Bodega;
  desdeUrl: { toneladas: string | null; costoCopKg: string | null };
}

const INICIAL: EstadoFormulario = {};

const NOMBRE_FUENTE: Record<string, string> = {
  yahoo: "continuo de Yahoo",
  barchart_api: "Barchart OnDemand",
  barchart_csv: "CSV importado",
  manual: "carga manual",
};

interface Campos {
  inventarioId: string;
  toneladas: string;
  costoCopKg: string;
  fechaEmbarque: string;
  diferencialUsdTm: string;
  tipoContrato: string;
  precioVentaUsdTm: string;
}

const VACIO: Campos = {
  inventarioId: "",
  toneladas: "",
  costoCopKg: "",
  fechaEmbarque: "",
  diferencialUsdTm: "",
  tipoContrato: "sin_contrato",
  precioVentaUsdTm: "",
};

function desdeLote(lote: Lote | undefined): Campos {
  if (!lote) return VACIO;
  return {
    inventarioId: lote.id,
    toneladas: String(lote.toneladas),
    costoCopKg: String(lote.costo_cop_kg),
    fechaEmbarque: lote.fecha_embarque,
    diferencialUsdTm: String(lote.diferencial_usd_tm),
    tipoContrato: lote.tipo_contrato,
    precioVentaUsdTm: lote.precio_venta_usd_tm != null ? String(lote.precio_venta_usd_tm) : "",
  };
}

export function FormularioAnalisis({ lotes, loteInicial, series, bodega, desdeUrl }: Props) {
  const [estado, enviar, enviando] = useActionState(ejecutarAnalisis, INICIAL);
  const [situacion, setSituacion] = useState<"tengo_cacao" | "ya_vendi">("tengo_cacao");
  const [campos, setCampos] = useState<Campos>(() => {
    const base = desdeLote(lotes.find((l) => l.id === loteInicial));
    return {
      ...base,
      toneladas: desdeUrl.toneladas ?? base.toneladas,
      costoCopKg: desdeUrl.costoCopKg ?? base.costoCopKg,
    };
  });

  const errores = estado.errores ?? {};
  const actualizar = (parcial: Partial<Campos>) =>
    setCampos((previo) => ({ ...previo, ...parcial }));

  const usarBodega = () =>
    actualizar({
      inventarioId: "",
      toneladas: bodega.toneladas.toFixed(4),
      costoCopKg: bodega.costoCopKg ? String(Math.round(bodega.costoCopKg)) : campos.costoCopKg,
    });

  const contratos = Number(campos.toneladas.replace(",", ".")) / CC_TONELADAS_POR_CONTRATO;

  return (
    <form action={enviar} className="space-y-6">
      <input type="hidden" name="inventarioId" value={campos.inventarioId} />
      <input type="hidden" name="situacion" value={situacion} />

      {/* --- Paso 1: qué caso es. Decide el sentido de la cobertura. --- */}
      <fieldset className="space-y-3 rounded-lg border border-borde bg-superficie p-5">
        <legend className="px-1 text-sm font-semibold">1 · ¿En qué situación está?</legend>
        <p className="text-xs leading-relaxed text-texto-suave">
          De esto depende todo: el riesgo va en un sentido o en el contrario, y la
          cobertura también.
        </p>

        <div className="space-y-2">
          {[
            {
              valor: "tengo_cacao" as const,
              titulo: "Tengo el cacao y aún no lo he vendido",
              detalle:
                "El riesgo es que el precio BAJE: tendría que venderlo por menos de lo que costó. Se cubre vendiendo futuros.",
            },
            {
              valor: "ya_vendi" as const,
              titulo: "Ya vendí a precio cerrado y me falta comprar el cacao",
              detalle:
                "El riesgo es que el precio SUBA: tendría que comprarlo más caro de lo que lo vendió. Se cubre comprando futuros.",
            },
          ].map((opcion) => (
            <label
              key={opcion.valor}
              className={`flex cursor-pointer gap-3 rounded-md border p-3 transition ${
                situacion === opcion.valor
                  ? "border-cacao bg-cacao/5"
                  : "border-borde hover:border-cacao-claro"
              }`}
            >
              <input
                type="radio"
                name="situacionVisible"
                checked={situacion === opcion.valor}
                onChange={() => setSituacion(opcion.valor)}
                className="mt-1 accent-[var(--cacao)]"
              />
              <span>
                <span className="block text-sm font-medium">{opcion.titulo}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-texto-suave">
                  {opcion.detalle}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {situacion === "ya_vendi" ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-ambar/40 bg-ambar/5 p-4 text-sm leading-relaxed"
        >
          <p className="font-semibold">Este caso todavía no está cubierto.</p>
          <p className="text-texto-suave">
            Su cobertura sería <strong>comprar</strong> futuros, y el motor solo calcula
            coberturas de venta. Darle un resultado sería darle el consejo al revés:
            vender futuros cuando necesita comprarlos <em>duplicaría</em> su exposición
            en lugar de cubrirla.
          </p>
          <p className="text-texto-suave">
            Lo que sí puede hacer hoy: analizar el cacao que ya tiene en bodega.
          </p>
        </div>
      ) : (
        <>
          {/* --- Paso 2: cuánto. Sale de la bodega si está sincronizada. --- */}
          <fieldset className="space-y-4 rounded-lg border border-borde bg-superficie p-5">
            <legend className="px-1 text-sm font-semibold">2 · ¿Cuánto cacao?</legend>

            {bodega.lotes > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-borde bg-fondo p-3">
                <div>
                  <p className="text-sm">
                    En bodega tiene{" "}
                    <span className="tabular font-semibold">
                      {fmtToneladas(bodega.toneladas)} TM
                    </span>{" "}
                    <span className="text-texto-suave">en {bodega.lotes} lotes</span>
                  </p>
                  <p className="mt-0.5 text-xs text-texto-suave">
                    {bodega.costoCopKg
                      ? `Costo ponderado ${usdTm(bodega.costoCopKg)} COP/kg sobre el ${(bodega.kgConCostoPorcentaje * 100).toFixed(0)} % de los kilos.`
                      : "Ningún lote declara precio de compra en la hoja."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={usarBodega}
                  className="rounded-md border border-cacao px-3 py-1.5 text-sm text-cacao transition hover:bg-cacao hover:text-white"
                >
                  Usar todo
                </button>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-borde px-3 py-2 text-xs text-texto-suave">
                No hay inventario sincronizado.{" "}
                <Link href="/bodega" className="text-cacao hover:underline">
                  Traerlo de la hoja
                </Link>{" "}
                rellena la cantidad y el costo automáticamente.
              </p>
            )}

            {lotes.length > 0 ? (
              <Campo id="lote" etiqueta="O partir de un lote guardado">
                <select
                  id="lote"
                  value={campos.inventarioId}
                  onChange={(e) =>
                    setCampos(desdeLote(lotes.find((l) => l.id === e.target.value)))
                  }
                  className={CLASES_INPUT}
                >
                  <option value="">Sin lote</option>
                  {lotes.map((lote) => (
                    <option key={lote.id} value={lote.id}>
                      {lote.nombre} · {lote.toneladas} TM
                    </option>
                  ))}
                </select>
              </Campo>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <Campo
                id="toneladas"
                etiqueta="Toneladas métricas"
                ayuda={
                  Number.isFinite(contratos) && contratos > 0
                    ? `Equivale a ${contratos.toLocaleString("es-CO", { maximumFractionDigits: 2 })} contratos CC de 10 TM.`
                    : "Un contrato CC cubre exactamente 10 TM."
                }
                error={errores.toneladas}
              >
                <input
                  id="toneladas"
                  name="toneladas"
                  inputMode="decimal"
                  required
                  placeholder="15,275"
                  value={campos.toneladas}
                  onChange={(e) => actualizar({ toneladas: e.target.value })}
                  className={CLASES_INPUT}
                />
              </Campo>

              <Campo
                id="costoCopKg"
                etiqueta="Costo de adquisición (COP/kg)"
                ayuda="Lo que le costó el kilo puesto en bodega. Define su punto de equilibrio."
                error={errores.costoCopKg}
              >
                <input
                  id="costoCopKg"
                  name="costoCopKg"
                  inputMode="decimal"
                  required
                  placeholder="16.468"
                  value={campos.costoCopKg}
                  onChange={(e) => actualizar({ costoCopKg: e.target.value })}
                  className={CLASES_INPUT}
                />
              </Campo>
            </div>
          </fieldset>

          {/* --- Paso 3: lo que la hoja no sabe: decisiones comerciales. --- */}
          <fieldset className="space-y-4 rounded-lg border border-borde bg-superficie p-5">
            <legend className="px-1 text-sm font-semibold">3 · Su operación</legend>
            <p className="text-xs leading-relaxed text-texto-suave">
              Esto no está en la hoja de inventario: son decisiones suyas y hay que
              ponerlas a mano.
            </p>

            <div className="grid gap-5 sm:grid-cols-2">
              <Campo
                id="fechaEmbarque"
                etiqueta="Fecha de embarque"
                ayuda="Cuándo sale el contenedor. Marca el horizonte del riesgo y el vencimiento de las opciones."
                error={errores.fechaEmbarque}
              >
                <input
                  id="fechaEmbarque"
                  name="fechaEmbarque"
                  type="date"
                  required
                  value={campos.fechaEmbarque}
                  onChange={(e) => actualizar({ fechaEmbarque: e.target.value })}
                  className={CLASES_INPUT}
                />
              </Campo>

              <Campo
                id="diferencialUsdTm"
                etiqueta="Diferencial sobre Nueva York (USD/TM)"
                ayuda="La prima o descuento de SU cacao frente al futuro. Positivo si le pagan por encima. La cobertura NO fija este número."
                error={errores.diferencialUsdTm}
              >
                <input
                  id="diferencialUsdTm"
                  name="diferencialUsdTm"
                  inputMode="decimal"
                  required
                  placeholder="250"
                  value={campos.diferencialUsdTm}
                  onChange={(e) => actualizar({ diferencialUsdTm: e.target.value })}
                  className={CLASES_INPUT}
                />
              </Campo>
            </div>

            <Campo
              id="tipoContrato"
              etiqueta="¿Cómo está pactada la venta?"
              error={errores.tipoContrato}
            >
              <select
                id="tipoContrato"
                name="tipoContrato"
                value={campos.tipoContrato}
                onChange={(e) => actualizar({ tipoContrato: e.target.value })}
                className={CLASES_INPUT}
              >
                <option value="sin_contrato">Aún sin comprador</option>
                <option value="por_fijar_ny">Comprador con precio por fijar contra NY</option>
                <option value="precio_fijo_usd">Precio ya cerrado en USD</option>
              </select>
            </Campo>

            {campos.tipoContrato === "precio_fijo_usd" ? (
              <Campo
                id="precioVentaUsdTm"
                etiqueta="Precio pactado (USD/TM)"
                ayuda="Con el precio cerrado el riesgo de mercado ya no existe: lo que queda vivo es el cambiario."
                error={errores.precioVentaUsdTm}
              >
                <input
                  id="precioVentaUsdTm"
                  name="precioVentaUsdTm"
                  inputMode="decimal"
                  placeholder="6.211"
                  value={campos.precioVentaUsdTm}
                  onChange={(e) => actualizar({ precioVentaUsdTm: e.target.value })}
                  className={CLASES_INPUT}
                />
              </Campo>
            ) : (
              <input type="hidden" name="precioVentaUsdTm" value="" />
            )}

            {series.length > 0 ? (
              <Campo
                id="origenCacao"
                etiqueta="Contrato de referencia"
                ayuda="La serie de precios contra la que se calcula. Un vencimiento concreto es más preciso que el continuo; verifique que siga vivo."
              >
                <select id="origenCacao" name="origenCacao" className={CLASES_INPUT}>
                  <option value="">Fuente en vivo (continuo)</option>
                  {series.map((serie) => (
                    <option
                      key={`${serie.simbolo}|${serie.fuente}`}
                      value={`${serie.simbolo}|${serie.fuente}`}
                    >
                      {serie.simbolo} · {NOMBRE_FUENTE[serie.fuente] ?? serie.fuente} ·{" "}
                      {serie.barras} barras hasta {serie.ultima}
                    </option>
                  ))}
                </select>
              </Campo>
            ) : null}
          </fieldset>

          {estado.mensaje ? (
            <p
              role="alert"
              className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo"
            >
              {estado.mensaje}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
          >
            {enviando ? "Calculando…" : "Analizar cobertura"}
          </button>
        </>
      )}
    </form>
  );
}
