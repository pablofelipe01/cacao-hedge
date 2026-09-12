"use client";

import { useActionState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { sincronizarPreciosProductor, type EstadoPrecios } from "@/lib/acciones/precios-productor";
import { HOJA_PRECIOS_POR_DEFECTO } from "@/lib/data/hoja-precios-productor";

const INICIAL: EstadoPrecios = {};

export function FormularioPrecios() {
  const [estado, enviar, enviando] = useActionState(sincronizarPreciosProductor, INICIAL);

  return (
    <form action={enviar} className="space-y-4">
      <Campo
        id="hoja"
        etiqueta="Hoja de precios"
        ayuda="Pegue el enlace o el identificador. Debe estar compartida como «cualquiera con el enlace puede ver»."
      >
        <input
          id="hoja"
          name="hoja"
          defaultValue={HOJA_PRECIOS_POR_DEFECTO}
          className={CLASES_INPUT}
        />
      </Campo>

      <button
        type="submit"
        disabled={enviando}
        className="rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60"
      >
        {enviando ? "Trayendo precios…" : "Sincronizar precios"}
      </button>

      {estado.error ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          {estado.error}
        </p>
      ) : null}

      {estado.mensaje ? (
        <div className="space-y-1 rounded-md border border-positivo/40 bg-positivo/5 px-3 py-2 text-sm">
          <p>{estado.mensaje}</p>
          {estado.detalle?.ultimaFecha ? (
            <p className="text-xs text-texto-suave">
              Último día con precio: {estado.detalle.ultimaFecha}
            </p>
          ) : null}
          {estado.detalle?.advertencias.map((a) => (
            <p key={a} className="text-xs text-texto-suave">▸ {a}</p>
          ))}
        </div>
      ) : null}
    </form>
  );
}
