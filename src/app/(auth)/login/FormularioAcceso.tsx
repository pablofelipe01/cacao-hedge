"use client";

import { useActionState, useState } from "react";

import {
  iniciarSesion,
  registrarse,
  type EstadoFormulario,
} from "./acciones";

const ESTADO_INICIAL: EstadoFormulario = {};

export function FormularioAcceso({ redirigir }: { redirigir: string }) {
  const [modo, setModo] = useState<"entrar" | "registrar">("entrar");
  const accion = modo === "entrar" ? iniciarSesion : registrarse;
  const [estado, enviar, enviando] = useActionState(accion, ESTADO_INICIAL);

  return (
    <form
      action={enviar}
      className="space-y-4 rounded-lg border border-borde bg-superficie p-5"
    >
      <input type="hidden" name="redirigir" value={redirigir} />

      <div className="flex gap-1 rounded-md bg-fondo p-1 text-sm">
        {(["entrar", "registrar"] as const).map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => setModo(valor)}
            aria-pressed={modo === valor}
            className={`flex-1 rounded px-3 py-1.5 transition ${
              modo === valor
                ? "bg-cacao font-medium text-white"
                : "text-texto-suave hover:text-texto"
            }`}
          >
            {valor === "entrar" ? "Iniciar sesión" : "Crear cuenta"}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <label htmlFor="correo" className="block text-sm font-medium">
          Correo
        </label>
        <input
          id="correo"
          name="correo"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-md border border-borde bg-fondo px-3 py-2 text-sm outline-none focus:border-cacao"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="clave" className="block text-sm font-medium">
          Contraseña
        </label>
        <input
          id="clave"
          name="clave"
          type="password"
          required
          minLength={6}
          autoComplete={modo === "entrar" ? "current-password" : "new-password"}
          className="w-full rounded-md border border-borde bg-fondo px-3 py-2 text-sm outline-none focus:border-cacao"
        />
      </div>

      {estado.error ? (
        <p role="alert" className="text-sm text-negativo">
          {estado.error}
        </p>
      ) : null}
      {estado.aviso ? (
        <p role="status" className="text-sm text-positivo">
          {estado.aviso}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60"
      >
        {enviando
          ? "Procesando…"
          : modo === "entrar"
            ? "Entrar"
            : "Crear cuenta"}
      </button>
    </form>
  );
}
