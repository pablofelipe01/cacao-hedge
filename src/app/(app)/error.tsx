"use client";

import { useEffect } from "react";

/**
 * Frontera de error de las rutas privadas.
 *
 * No muestra el mensaje crudo de la excepción: puede filtrar detalles del
 * servidor y no le dice nada útil a un exportador. El `digest` sí se
 * enseña porque es lo que permite localizar el error en los registros.
 */
export default function ErrorApp({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error en la aplicación:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Algo se rompió</h1>
      <p className="text-sm leading-relaxed text-texto-suave">
        No se pudo mostrar esta pantalla. Los datos guardados no se vieron afectados:
        cada análisis queda persistido al calcularse.
      </p>
      {error.digest ? (
        <p className="tabular text-xs text-texto-suave">
          Referencia para soporte: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-cacao px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cacao-claro"
      >
        Reintentar
      </button>
    </div>
  );
}
