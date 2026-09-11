"use client";

import { useActionState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { sincronizarBodega, type EstadoBodega } from "@/lib/acciones/bodega";
import { HOJA_INVENTARIO_POR_DEFECTO } from "@/lib/data/hoja-inventario";

const INICIAL: EstadoBodega = {};

export function FormularioSincronizar() {
  const [estado, enviar, sincronizando] = useActionState(sincronizarBodega, INICIAL);

  return (
    <form action={enviar} className="space-y-4 rounded-lg border border-borde bg-superficie p-5">
      <Campo
        id="hoja"
        etiqueta="Hoja de cálculo"
        ayuda="Pegue la URL o el identificador. La hoja debe estar compartida como «cualquiera con el enlace puede ver»."
      >
        <input
          id="hoja"
          name="hoja"
          defaultValue={HOJA_INVENTARIO_POR_DEFECTO}
          className={CLASES_INPUT}
        />
      </Campo>

      {estado.error ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          {estado.error}
        </p>
      ) : null}

      {estado.mensaje && estado.detalle ? (
        <div role="status" className="rounded-md border border-positivo/40 bg-positivo/5 px-3 py-2 text-sm">
          <p className="text-positivo">{estado.mensaje}</p>
          <p className="tabular mt-1 text-xs text-texto-suave">
            {estado.detalle.totalKg.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg
            {estado.detalle.totalDeclaradoKg != null ? (
              <>
                {" · "}
                {estado.detalle.cuadra
                  ? "coincide con el total declarado en la hoja"
                  : `⚠ la hoja declara ${estado.detalle.totalDeclaradoKg.toLocaleString("es-CO", { maximumFractionDigits: 2 })} kg — revise la hoja`}
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={sincronizando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
      >
        {sincronizando ? "Leyendo la hoja…" : "Sincronizar desde la hoja"}
      </button>
    </form>
  );
}
