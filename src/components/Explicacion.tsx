"use client";

import { useId } from "react";

import { GLOSARIO, type ClaveGlosario } from "@/lib/glosario";

interface Props {
  termino: ClaveGlosario;
  /** Texto del disparador. Por defecto, el rótulo de la cifra. */
  children?: React.ReactNode;
  /** `signo` pinta un «?» aparte en vez de hacer clicable el rótulo. */
  variante?: "rotulo" | "signo";
}

/**
 * Explicación de una cifra, al alcance de un clic.
 *
 * Usa la API nativa de popover del navegador en vez de montar uno a mano.
 * Sale gratis lo que suele salir mal: cerrar al tocar fuera, cerrar con
 * Escape, quedar por encima de todo sin pelear con z-index, y devolver el
 * foco al disparador. Un popover casero habría necesitado código para
 * cada una de esas cuatro cosas, y habría fallado en alguna.
 *
 * El texto NO vive aquí: viene de `@/lib/glosario`, que es la misma
 * fuente que alimenta la página de la guía. Escribirlo dos veces bastaría
 * para que en unos meses dijeran cosas distintas del mismo número.
 */
export function Explicacion({ termino, children, variante = "rotulo" }: Props) {
  const id = useId();
  const entrada = GLOSARIO[termino];

  const disparador =
    variante === "signo" ? (
      <button
        type="button"
        popoverTarget={id}
        aria-label={`Qué significa: ${entrada.titulo}`}
        className="ml-1 inline-flex size-4 items-center justify-center rounded-full border border-borde align-middle text-[0.6rem] leading-none text-texto-suave transition hover:border-cacao hover:text-cacao"
      >
        ?
      </button>
    ) : (
      <button
        type="button"
        popoverTarget={id}
        className="cursor-help text-left underline decoration-borde decoration-dotted underline-offset-4 transition hover:decoration-cacao"
      >
        {children ?? entrada.titulo}
      </button>
    );

  return (
    <>
      {disparador}

      <div
        id={id}
        popover="auto"
        className="max-w-sm space-y-2 rounded-lg border border-borde bg-superficie p-4 text-left shadow-lg backdrop:bg-black/40"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold">{entrada.titulo}</h3>
          {"ejemplo" in entrada && entrada.ejemplo ? (
            <span className="tabular rounded border border-borde px-1.5 py-0.5 text-xs text-texto-suave">
              {entrada.ejemplo}
            </span>
          ) : null}
        </div>

        <p className="text-sm leading-relaxed text-texto-suave">{entrada.que}</p>

        {"ojo" in entrada && entrada.ojo ? (
          <p className="border-l-2 border-ambar pl-3 text-sm leading-relaxed">
            <span className="font-medium">Ojo:</span>{" "}
            <span className="text-texto-suave">{entrada.ojo}</span>
          </p>
        ) : null}

        <button
          type="button"
          popoverTarget={id}
          popoverTargetAction="hide"
          className="text-xs text-texto-suave underline underline-offset-2 hover:text-texto"
        >
          Cerrar
        </button>
      </div>
    </>
  );
}
