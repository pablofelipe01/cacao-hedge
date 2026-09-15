import type { ReactNode } from "react";

import { Explicacion } from "./Explicacion";
import type { ClaveGlosario } from "@/lib/glosario";

interface Props {
  etiqueta: string;
  valor: string;
  unidad?: string;
  detalle?: ReactNode;
  /** Tiñe la cifra solo cuando el signo tiene significado financiero. */
  tono?: "neutro" | "positivo" | "negativo";
  /** Entrada del glosario: añade un «?» que abre la explicación. */
  explica?: ClaveGlosario;
}

/**
 * Tarjeta de métrica.
 *
 * La cifra va en figuras proporcionales, no tabulares: a tamaño grande
 * los dígitos de ancho fijo se ven sueltos. Las tabulares se reservan
 * para columnas que deben alinearse.
 */
export function TarjetaMetrica({
  etiqueta,
  valor,
  unidad,
  detalle,
  tono = "neutro",
  explica,
}: Props) {
  const color =
    tono === "positivo" ? "text-positivo" : tono === "negativo" ? "text-negativo" : "text-texto";

  return (
    <div className="rounded-lg border border-borde bg-superficie p-4">
      <p className="text-xs font-medium text-texto-suave">
        {etiqueta}
        {explica ? <Explicacion termino={explica} variante="signo" /> : null}
      </p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight ${color}`}>
        {valor}
        {unidad ? (
          <span className="ml-1 text-sm font-normal text-texto-suave">{unidad}</span>
        ) : null}
      </p>
      {detalle ? <div className="mt-1 text-xs text-texto-suave">{detalle}</div> : null}
    </div>
  );
}
