"use client";

import { useActionState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { establecerClave } from "@/lib/acciones/clave";
import type { EstadoFormulario } from "@/lib/acciones/inventario";

const INICIAL: EstadoFormulario = {};

export function FormularioClave() {
  const [estado, enviar, guardando] = useActionState(establecerClave, INICIAL);
  const errores = estado.errores ?? {};

  return (
    <form action={enviar} className="space-y-5 rounded-lg border border-borde bg-superficie p-5">
      <Campo
        id="clave"
        etiqueta="Nueva contraseña"
        ayuda="Mínimo 8 caracteres. Nadie más la ve: viaja cifrada y Supabase solo guarda su hash."
        error={errores.clave}
      >
        <input
          id="clave"
          name="clave"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={CLASES_INPUT}
        />
      </Campo>

      <Campo id="repetida" etiqueta="Repítala" error={errores.repetida}>
        <input
          id="repetida"
          name="repetida"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={CLASES_INPUT}
        />
      </Campo>

      {estado.mensaje ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          {estado.mensaje}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={guardando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60"
      >
        {guardando ? "Guardando…" : "Guardar contraseña"}
      </button>
    </form>
  );
}
