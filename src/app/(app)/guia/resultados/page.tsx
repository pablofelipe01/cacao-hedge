import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import {
  GLOSARIO,
  SECCIONES_GLOSARIO,
  type EntradaGlosario,
} from "@/lib/glosario";

/**
 * Coquito: qué quiere decir cada cifra de la pantalla de resultados.
 *
 * La guía general explica el negocio; esta explica la PANTALLA, casilla
 * por casilla, en el orden en que aparecen. Nació de una sesión real
 * mirando un análisis con el cliente: las preguntas no eran «¿qué es una
 * cobertura?» sino «¿qué me está diciendo este número?».
 *
 * Contenido estático: sin consultas, sin estado, sin JavaScript de
 * cliente.
 */
export const metadata = {
  title: "Qué significa cada cifra · CacaoHedge",
  description:
    "Recorrido casilla por casilla de la pantalla de resultados: qué es cada número, qué quiere decir y qué hay que tener en cuenta.",
};

/**
 * El contenido NO vive aquí.
 *
 * Sale de `@/lib/glosario`, que es la misma fuente que alimenta el popup
 * que aparece al tocar una cifra en la pantalla de resultados. Tenerlo
 * escrito dos veces habría bastado para que en unos meses el popup y esta
 * página dijeran cosas distintas del mismo número.
 */

export default function PaginaCoquito() {
  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">
            Qué significa cada cifra
          </h1>
          <Link
            href="/guia"
            className="text-sm text-texto-suave hover:text-texto"
          >
            ← Guía
          </Link>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          Recorrido de la pantalla de resultados, en el orden en que aparece.
          Para cada número: qué es, qué quiere decir, y qué conviene tener en
          cuenta. Los ejemplos salen de un análisis real.
        </p>
      </header>

      {SECCIONES_GLOSARIO.map((bloque) => (
        <section
          key={bloque.seccion}
          aria-labelledby={bloque.seccion}
          className="space-y-4"
        >
          <div className="space-y-1">
            <h2 id={bloque.seccion} className="text-sm font-semibold">
              {bloque.seccion}
            </h2>
            {bloque.intro ? (
              <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
                {bloque.intro}
              </p>
            ) : null}
          </div>

          <div className="divide-y divide-borde border-y border-borde">
            {bloque.claves.map((clave) => {
              const cifra: EntradaGlosario = GLOSARIO[clave];
              return (
                <div key={clave} className="space-y-1.5 py-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-sm font-medium">{cifra.titulo}</h3>
                    {cifra.ejemplo ? (
                      <span className="tabular rounded border border-borde px-1.5 py-0.5 text-xs text-texto-suave">
                        {cifra.ejemplo}
                      </span>
                    ) : null}
                  </div>

                  <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
                    {cifra.que}
                  </p>

                  {cifra.ojo ? (
                    <p className="max-w-prose border-l-2 border-ambar pl-3 text-sm leading-relaxed">
                      <span className="font-medium">Ojo:</span>{" "}
                      <span className="text-texto-suave">{cifra.ojo}</span>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Si solo se lleva tres cosas</h2>
        <ol className="space-y-3">
          {[
            "Mire primero el colchón: la distancia entre el futuro de hoy y su punto de equilibrio. Si es grande, casi no tiene riesgo y la cobertura es opcional.",
            "Después mire el percentil 5, no el promedio. Es el número que decide, porque es el que lo quiebra.",
            "Y antes de cubrirse con futuros, tenga resuelta la caja de las llamadas de margen. Es lo único que puede salir mal aunque la cobertura esté bien puesta.",
          ].map((texto, i) => (
            <li
              key={texto}
              className="grid grid-cols-[1.5rem_1fr] gap-3 text-sm leading-relaxed"
            >
              <span className="tabular border-b border-borde pb-0.5 text-xs text-ambar">
                {i + 1}
              </span>
              <span className="max-w-prose text-texto-suave">{texto}</span>
            </li>
          ))}
        </ol>

        <Link
          href="/analisis/nuevo"
          className="inline-block rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro"
        >
          Hacer un análisis
        </Link>
      </section>

      <Disclaimer />
    </div>
  );
}
