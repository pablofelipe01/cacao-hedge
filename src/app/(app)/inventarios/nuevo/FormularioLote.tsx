"use client";

import { useActionState, useState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { crearLote, type EstadoFormulario } from "@/lib/acciones/inventario";

const INICIAL: EstadoFormulario = {};

export function FormularioLote() {
  const [estado, enviar, enviando] = useActionState(crearLote, INICIAL);
  const [tipoContrato, setTipoContrato] = useState("sin_contrato");
  const errores = estado.errores ?? {};

  return (
    <form action={enviar} className="space-y-5 rounded-lg border border-borde bg-superficie p-5">
      <Campo id="nombre" etiqueta="Nombre del lote" error={errores.nombre}>
        <input
          id="nombre"
          name="nombre"
          required
          placeholder="Lote Tumaco 03"
          className={CLASES_INPUT}
          aria-describedby={errores.nombre ? "nombre-error" : undefined}
        />
      </Campo>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo
          id="toneladas"
          etiqueta="Toneladas métricas"
          ayuda="Un contrato CC cubre exactamente 10 TM."
          error={errores.toneladas}
        >
          <input
            id="toneladas"
            name="toneladas"
            inputMode="decimal"
            required
            placeholder="137"
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo
          id="costoCopKg"
          etiqueta="Costo de adquisición (COP/kg)"
          ayuda="Lo que le costó el kilo puesto en bodega."
          error={errores.costoCopKg}
        >
          <input
            id="costoCopKg"
            name="costoCopKg"
            inputMode="decimal"
            required
            placeholder="14500"
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo id="ubicacion" etiqueta="Ubicación" error={errores.ubicacion}>
          <input
            id="ubicacion"
            name="ubicacion"
            required
            placeholder="Bodega Buenaventura"
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo id="fechaEmbarque" etiqueta="Fecha estimada de embarque" error={errores.fechaEmbarque}>
          <input
            id="fechaEmbarque"
            name="fechaEmbarque"
            type="date"
            required
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo
          id="diferencialUsdTm"
          etiqueta="Diferencial vs. futuro NY (USD/TM)"
          ayuda="Prima positiva, descuento negativo. El fino de aroma suele ir con prima."
          error={errores.diferencialUsdTm}
        >
          <input
            id="diferencialUsdTm"
            name="diferencialUsdTm"
            inputMode="decimal"
            defaultValue="0"
            required
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo
          id="mesFuturo"
          etiqueta="Vencimiento de referencia (opcional)"
          ayuda="H marzo · K mayo · N julio · U septiembre · Z diciembre. Ej.: Z26."
          error={errores.mesFuturo}
        >
          <input
            id="mesFuturo"
            name="mesFuturo"
            placeholder="Z26"
            className={CLASES_INPUT}
          />
        </Campo>
      </div>

      <Campo id="tipoContrato" etiqueta="Contrato de venta" error={errores.tipoContrato}>
        <select
          id="tipoContrato"
          name="tipoContrato"
          value={tipoContrato}
          onChange={(e) => setTipoContrato(e.target.value)}
          className={CLASES_INPUT}
        >
          <option value="sin_contrato">Aún sin contrato</option>
          <option value="por_fijar_ny">Por fijar contra futuros NY</option>
          <option value="precio_fijo_usd">Precio fijo en USD</option>
        </select>
      </Campo>

      {tipoContrato === "precio_fijo_usd" ? (
        <Campo
          id="precioVentaUsdTm"
          etiqueta="Precio pactado (USD/TM)"
          ayuda="Con precio fijo el riesgo de precio ya está cerrado: lo que queda vivo es el cambiario."
          error={errores.precioVentaUsdTm}
        >
          <input
            id="precioVentaUsdTm"
            name="precioVentaUsdTm"
            inputMode="decimal"
            className={CLASES_INPUT}
          />
        </Campo>
      ) : (
        <input type="hidden" name="precioVentaUsdTm" value="" />
      )}

      <Campo id="notas" etiqueta="Notas (opcional)">
        <textarea id="notas" name="notas" rows={2} className={CLASES_INPUT} />
      </Campo>

      {estado.mensaje ? (
        <p role="alert" className="text-sm text-negativo">
          {estado.mensaje}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
      >
        {enviando ? "Guardando…" : "Guardar y analizar"}
      </button>
    </form>
  );
}
