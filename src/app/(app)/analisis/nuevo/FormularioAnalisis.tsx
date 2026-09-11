"use client";

import { useActionState, useState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { ejecutarAnalisis } from "@/lib/acciones/analisis";
import type { EstadoFormulario } from "@/lib/acciones/inventario";
import type { SerieDisponible } from "@/lib/data/cache";

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

interface Props {
  lotes: Lote[];
  loteInicial: string | null;
  series: SerieDisponible[];
  /** Cantidad y costo traídos del inventario real de bodega. */
  desdeBodega?: { toneladas: string | null; costoCopKg: string | null };
}

const INICIAL: EstadoFormulario = {};

/** Valores del formulario, rellenables desde un lote guardado. */
interface Campos {
  inventarioId: string;
  toneladas: string;
  costoCopKg: string;
  fechaEmbarque: string;
  diferencialUsdTm: string;
  tipoContrato: string;
  precioVentaUsdTm: string;
}

function desdeLote(lote: Lote | undefined): Campos {
  if (!lote) {
    return {
      inventarioId: "",
      toneladas: "",
      costoCopKg: "",
      fechaEmbarque: "",
      diferencialUsdTm: "0",
      tipoContrato: "sin_contrato",
      precioVentaUsdTm: "",
    };
  }

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

/** Nombre legible de cada fuente, para el selector. */
const NOMBRE_FUENTE: Record<string, string> = {
  yahoo: "continuo de Yahoo",
  barchart_api: "Barchart OnDemand",
  barchart_csv: "CSV importado",
  manual: "carga manual",
  datos_gov_co: "datos.gov.co",
};

export function FormularioAnalisis({ lotes, loteInicial, series, desdeBodega }: Props) {
  const [estado, enviar, enviando] = useActionState(ejecutarAnalisis, INICIAL);
  const [campos, setCampos] = useState<Campos>(() => {
    const base = desdeLote(lotes.find((l) => l.id === loteInicial));
    // Lo que viene de bodega son cifras reales: manda sobre los vacíos.
    return {
      ...base,
      toneladas: desdeBodega?.toneladas ?? base.toneladas,
      costoCopKg: desdeBodega?.costoCopKg ?? base.costoCopKg,
    };
  });

  const errores = estado.errores ?? {};
  const actualizar = (parcial: Partial<Campos>) =>
    setCampos((previo) => ({ ...previo, ...parcial }));

  return (
    <form action={enviar} className="space-y-5 rounded-lg border border-borde bg-superficie p-5">
      <input type="hidden" name="inventarioId" value={campos.inventarioId} />

      {lotes.length > 0 ? (
        <Campo
          id="lote"
          etiqueta="Partir de un lote guardado"
          ayuda="Opcional: rellena el formulario con los datos del lote."
        >
          <select
            id="lote"
            value={campos.inventarioId}
            onChange={(e) => setCampos(desdeLote(lotes.find((l) => l.id === e.target.value)))}
            className={CLASES_INPUT}
          >
            <option value="">Sin lote (datos sueltos)</option>
            {lotes.map((lote) => (
              <option key={lote.id} value={lote.id}>
                {lote.nombre} · {lote.toneladas} TM
              </option>
            ))}
          </select>
        </Campo>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id="toneladas" etiqueta="Toneladas métricas" error={errores.toneladas}>
          <input
            id="toneladas"
            name="toneladas"
            inputMode="decimal"
            required
            value={campos.toneladas}
            onChange={(e) => actualizar({ toneladas: e.target.value })}
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo id="costoCopKg" etiqueta="Costo de adquisición (COP/kg)" error={errores.costoCopKg}>
          <input
            id="costoCopKg"
            name="costoCopKg"
            inputMode="decimal"
            required
            value={campos.costoCopKg}
            onChange={(e) => actualizar({ costoCopKg: e.target.value })}
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo
          id="fechaEmbarque"
          etiqueta="Fecha de embarque"
          ayuda="Define el horizonte del VaR y el vencimiento de las opciones."
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
          etiqueta="Diferencial (USD/TM)"
          ayuda="La cobertura con futuros NO fija este número."
          error={errores.diferencialUsdTm}
        >
          <input
            id="diferencialUsdTm"
            name="diferencialUsdTm"
            inputMode="decimal"
            required
            value={campos.diferencialUsdTm}
            onChange={(e) => actualizar({ diferencialUsdTm: e.target.value })}
            className={CLASES_INPUT}
          />
        </Campo>
      </div>

      {series.length > 0 ? (
        <Campo
          id="origenCacao"
          etiqueta="Contrato de referencia"
          ayuda="La serie de precios contra la que se calcula. Un vencimiento importado por CSV es más preciso que el continuo, pero verifique que siga vivo."
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

      <Campo id="tipoContrato" etiqueta="Contrato de venta" error={errores.tipoContrato}>
        <select
          id="tipoContrato"
          name="tipoContrato"
          value={campos.tipoContrato}
          onChange={(e) => actualizar({ tipoContrato: e.target.value })}
          className={CLASES_INPUT}
        >
          <option value="sin_contrato">Aún sin contrato</option>
          <option value="por_fijar_ny">Por fijar contra futuros NY</option>
          <option value="precio_fijo_usd">Precio fijo en USD</option>
        </select>
      </Campo>

      {campos.tipoContrato === "precio_fijo_usd" ? (
        <Campo
          id="precioVentaUsdTm"
          etiqueta="Precio pactado (USD/TM)"
          error={errores.precioVentaUsdTm}
        >
          <input
            id="precioVentaUsdTm"
            name="precioVentaUsdTm"
            inputMode="decimal"
            value={campos.precioVentaUsdTm}
            onChange={(e) => actualizar({ precioVentaUsdTm: e.target.value })}
            className={CLASES_INPUT}
          />
        </Campo>
      ) : (
        <input type="hidden" name="precioVentaUsdTm" value="" />
      )}

      {estado.mensaje ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          {estado.mensaje}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
      >
        {enviando ? "Calculando 90.000 trayectorias…" : "Analizar cobertura"}
      </button>
    </form>
  );
}
