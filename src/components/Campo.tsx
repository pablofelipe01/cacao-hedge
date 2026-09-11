import type { ReactNode } from "react";

interface Props {
  id: string;
  etiqueta: string;
  ayuda?: ReactNode;
  error?: string;
  children: ReactNode;
}

/**
 * Envoltorio de campo de formulario.
 *
 * El error se asocia con `aria-describedby` desde el input, así que un
 * lector de pantalla lo anuncia al enfocar el campo y no solo al enviar.
 */
export function Campo({ id, etiqueta, ayuda, error, children }: Props) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {etiqueta}
      </label>
      {children}
      {ayuda && !error ? (
        <p id={`${id}-ayuda`} className="text-xs text-texto-suave">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-negativo">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Clases compartidas por todos los inputs, para que no deriven entre formularios. */
export const CLASES_INPUT =
  "w-full rounded-md border border-borde bg-fondo px-3 py-2 text-sm outline-none focus:border-cacao disabled:opacity-60";
