"use client";

import { useRef, useState } from "react";

import { CLASES_INPUT } from "@/components/Campo";
import type { TurnoSimulador } from "@/lib/anthropic/simulador";
import type { EntradaCaso } from "@/lib/simulador/entrada";

interface Props {
  /** El caso calculado en pantalla, si lo hay. */
  entradaActual: EntradaCaso | null;
  onCargar: (entrada: EntradaCaso) => void;
}

const EJEMPLO =
  "Tengo la oportunidad de vender 300 toneladas a 6.500 USD/TM precio fijo, con entregas de 50 a 75 toneladas cada 15 días empezando en un mes. Con cada orden me dan 50 % de anticipo y el otro 50 % contra documentos en puerto. Tengo 2.000 millones de capital de trabajo. ¿Cómo la cubro?";

function resumenEntrada(e: EntradaCaso): string {
  const tm = e.entregas.reduce((a, x) => a + x.toneladas, 0);
  return `${tm.toLocaleString("es-CO")} TM a ${e.precioVentaUsdTm.toLocaleString("es-CO")} USD/TM · ${e.entregas.length} entregas · anticipo ${e.anticipoPct} % · capital ${(e.capitalCop / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 0 })} M`;
}

/**
 * Cuéntele el caso con sus palabras.
 *
 * El analista lo traduce a los campos del simulador, lo calcula con el
 * motor y responde con esas cifras. Cada caso que calculó se puede cargar
 * en el formulario para verlo completo y ajustarlo a mano.
 */
export function AnalistaSimulador({ entradaActual, onCargar }: Props) {
  const [turnos, setTurnos] = useState<TurnoSimulador[]>([]);
  const [pregunta, setPregunta] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  const preguntar = async (textoPregunta: string) => {
    const limpia = textoPregunta.trim();
    if (!limpia || pensando) return;

    const historial = turnos;
    setTurnos([...historial, { rol: "usuario", texto: limpia }]);
    setPregunta("");
    setError(null);
    setPensando(true);

    try {
      const r = await fetch("/api/simulador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Solo el texto del historial: los casos ya calculados no le hacen
        // falta al modelo y engordarían cada petición.
        body: JSON.stringify({
          entrada: entradaActual,
          pregunta: limpia,
          historial: historial.map(({ rol, texto }) => ({ rol, texto })),
        }),
      });
      const datos = await r.json();
      if (!r.ok) throw new Error(datos.error ?? "No se pudo responder.");
      setTurnos((previos) => [...previos, { rol: "analista", texto: datos.texto, casos: datos.casos }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo responder.");
    } finally {
      setPensando(false);
      requestAnimationFrame(() => finRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };

  return (
    <section aria-labelledby="analistaSim" className="space-y-3">
      <div>
        <h2 id="analistaSim" className="text-sm font-semibold">O cuénteselo al analista</h2>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-texto-suave">
          Descríbale la oportunidad con sus palabras. La pasa al simulador, la calcula con el motor
          —no estima cifras— y le responde. Cada caso que calcule lo puede cargar arriba para verlo
          completo. {entradaActual ? "Ya conoce el caso que tiene en pantalla." : null}
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-borde bg-superficie p-4">
        {turnos.length === 0 ? (
          <button
            type="button"
            onClick={() => setPregunta(EJEMPLO)}
            className="rounded-md border border-dashed border-borde px-3 py-2 text-left text-xs leading-relaxed text-texto-suave transition hover:border-cacao hover:text-cacao"
          >
            Por ejemplo: «{EJEMPLO}»
          </button>
        ) : null}

        {turnos.map((turno, i) => (
          <div
            key={i}
            className={
              turno.rol === "usuario"
                ? "ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-cacao px-3 py-2 text-sm text-white"
                : "max-w-[92%] space-y-2"
            }
          >
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{turno.texto}</p>
            {turno.casos && turno.casos.length > 0 ? (
              <div className="space-y-1 border-l-2 border-ambar pl-3">
                <p className="text-xs font-medium">Casos que calculó:</p>
                {turno.casos.map((c, j) => (
                  <div key={j} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-xs leading-relaxed text-texto-suave">
                      ▸ {c.descripcion} <span className="tabular">({resumenEntrada(c.entrada)})</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => onCargar(c.entrada)}
                      className="flex-none text-xs text-cacao hover:underline"
                    >
                      Cargar en el simulador
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        {pensando ? <p className="text-sm text-texto-suave">Calculando…</p> : null}
        {error ? (
          <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
            {error}
          </p>
        ) : null}
        <div ref={finRef} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            preguntar(pregunta);
          }}
          className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-end"
        >
          <textarea
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                preguntar(pregunta);
              }
            }}
            rows={pregunta.length > 90 ? 4 : 2}
            placeholder="¿Y si el anticipo fuera del 30 %?"
            aria-label="Mensaje para el analista"
            disabled={pensando}
            className={CLASES_INPUT}
          />
          <button
            type="submit"
            disabled={pensando || pregunta.trim() === ""}
            className="flex-none rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </div>

      <p className="max-w-prose text-xs leading-relaxed text-texto-suave">
        El analista interpreta; las cifras las calcula el motor. Esto es apoyo a la decisión y no
        asesoría financiera: verifique primas y márgenes con su bróker antes de operar.
      </p>
    </section>
  );
}
