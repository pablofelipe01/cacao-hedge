"use client";

import { useActionState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { importarHistorico, type EstadoImportacion } from "@/lib/acciones/importar";
import { ZonaCarga } from "./ZonaCarga";

const INICIAL: EstadoImportacion = {};

export function FormularioImportacion() {
  const [estado, enviar, enviando] = useActionState(importarHistorico, INICIAL);

  return (
    <form action={enviar} className="space-y-5 rounded-lg border border-borde bg-superficie p-5">
      <Campo
        id="archivo"
        etiqueta="Archivo CSV"
        ayuda="Acepta el export de barchart.com tal cual —incluidas las columnas «Time» y «Last» de los futuros— y también el que reescribe Excel con punto y coma. Basta con que traiga una columna de fecha y una de cierre."
      >
        <ZonaCarga id="archivo" name="archivo" />
      </Campo>

      <div className="grid gap-5 sm:grid-cols-2">
        <Campo
          id="simbolo"
          etiqueta="Símbolo (opcional)"
          ayuda="Déjelo vacío y se toma del CSV o del nombre del archivo (ccz26_… → CCZ26)."
        >
          <input
            id="simbolo"
            name="simbolo"
            placeholder="se detecta solo"
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo id="serie" etiqueta="Tipo de serie">
          <select id="serie" name="serie" defaultValue="CC" className={CLASES_INPUT}>
            <option value="CC">Cacao (USD/TM)</option>
            <option value="TRM">TRM (COP/USD)</option>
          </select>
        </Campo>
      </div>

      {estado.error ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          {estado.error}
        </p>
      ) : null}

      {estado.mensaje && estado.detalle ? (
        <div role="status" className="rounded-md border border-positivo/40 bg-positivo/5 px-3 py-2 text-sm">
          <p className="text-positivo">{estado.mensaje}</p>
          <p className="tabular mt-1 text-xs text-texto-suave">
            {estado.detalle.desde} → {estado.detalle.hasta}
            {estado.detalle.descartadas > 0
              ? ` · ${estado.detalle.descartadas} fila(s) descartadas por no traer fecha y cierre válidos`
              : ""}
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
      >
        {enviando ? "Importando…" : "Importar a la caché"}
      </button>
    </form>
  );
}
