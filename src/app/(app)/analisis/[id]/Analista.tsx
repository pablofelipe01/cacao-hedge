"use client";

import { useRef, useState, useTransition } from "react";

import { CLASES_INPUT } from "@/components/Campo";
import type { TurnoChat } from "@/lib/anthropic/analista";
import { aplicarEscenario } from "@/lib/acciones/escenario";

interface Props {
  analisisId: string;
}

/** Preguntas de arranque: lo que un exportador pregunta de verdad. */
const SUGERENCIAS = [
  "¿Y si solo consigo la mitad de las toneladas?",
  "¿Qué pasa si el cacao sube 20 % antes de que compre?",
  "¿Me conviene más el collar que los futuros?",
  "¿Cuánta caja necesito tener lista?",
];

/** Cómo se nombra cada cambio para el usuario, en vez de la clave interna. */
const NOMBRE_CAMBIO: Record<string, string> = {
  toneladas: "toneladas",
  diasAEmbarque: "días al embarque",
  precioVentaUsdTm: "precio de venta USD/TM",
  diferencialUsdTm: "diferencial USD/TM",
  diferencialPorcentaje: "diferencial % de NY",
  futuroUsdTm: "futuro USD/TM",
  trm: "TRM",
  costoCopKg: "costo COP/kg",
};

/**
 * Conversación con el analista sobre este análisis.
 *
 * Lo que lo separa de un chat cualquiera: cuando una pregunta exige
 * cifras que no están en pantalla, el modelo no las estima — llama a una
 * herramienta que vuelve a correr el motor y le devuelve números reales.
 * Esos recálculos se muestran debajo de cada respuesta, para que el
 * usuario vea sobre qué escenario le están hablando.
 */
export function Analista({ analisisId }: Props) {
  const [turnos, setTurnos] = useState<TurnoChat[]>([]);
  const [pregunta, setPregunta] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const [aplicando, iniciarAplicar] = useTransition();
  const [aplicandoClave, setAplicandoClave] = useState<string | null>(null);

  /** Guarda un recálculo como análisis nuevo; la acción redirige a él. */
  const aplicar = (clave: string, descripcion: string, cambios: Record<string, number>) => {
    setAplicandoClave(clave);
    setError(null);
    iniciarAplicar(async () => {
      const r = await aplicarEscenario(analisisId, descripcion, cambios);
      // Solo vuelve si falló: cuando sale bien, la acción redirige.
      if (r?.error) setError(r.error);
      setAplicandoClave(null);
    });
  };

  const preguntar = async (texto: string) => {
    const limpia = texto.trim();
    if (!limpia || pensando) return;

    const historial = turnos;
    setTurnos([...historial, { rol: "usuario", texto: limpia }]);
    setPregunta("");
    setError(null);
    setPensando(true);

    try {
      const r = await fetch("/api/analista", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analisisId, pregunta: limpia, historial }),
      });

      const datos = await r.json();
      if (!r.ok) throw new Error(datos.error ?? "No se pudo responder.");

      setTurnos((previos) => [
        ...previos,
        { rol: "analista", texto: datos.texto, recalculos: datos.recalculos },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo responder.");
    } finally {
      setPensando(false);
      // Deja la última respuesta a la vista sin saltar la página entera.
      requestAnimationFrame(() => finRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };

  return (
    <section aria-labelledby="analista" className="space-y-3">
      <div>
        <h2 id="analista" className="text-sm font-semibold">
          Pregúntele al analista
        </h2>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-texto-suave">
          Conversa sobre <strong className="font-semibold text-texto">este</strong> análisis.
          Si su pregunta necesita cifras que no están en pantalla, vuelve a correr el motor
          en vez de estimarlas, y le muestra qué escenario calculó.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-borde bg-superficie p-4">
        {turnos.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-texto-suave">Por ejemplo:</p>
            <div className="flex flex-wrap gap-2">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => preguntar(s)}
                  className="rounded-full border border-borde px-3 py-1.5 text-xs text-texto-suave transition hover:border-cacao hover:text-cacao"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
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

            {turno.recalculos && turno.recalculos.length > 0 ? (
              <div className="space-y-1 border-l-2 border-ambar pl-3">
                <p className="text-xs font-medium">Escenarios que recalculó:</p>
                {turno.recalculos.map((rec, j) => {
                  const clave = `${i}-${j}`;
                  const hayCambios = Object.keys(rec.cambios).length > 0;
                  return (
                    <div key={j} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-xs leading-relaxed text-texto-suave">
                        ▸ {rec.descripcion}
                        {hayCambios ? (
                          <span className="tabular">
                            {" "}
                            ({Object.entries(rec.cambios)
                              .map(([k, v]) => `${NOMBRE_CAMBIO[k] ?? k}: ${v.toLocaleString("es-CO")}`)
                              .join(", ")}
                            )
                          </span>
                        ) : null}
                      </p>
                      {hayCambios ? (
                        <button
                          type="button"
                          onClick={() => aplicar(clave, rec.descripcion, rec.cambios)}
                          disabled={aplicando}
                          className="flex-none text-xs text-cacao hover:underline disabled:opacity-50"
                        >
                          {aplicandoClave === clave ? "Guardando…" : "Aplicar este escenario"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <p className="text-xs text-texto-suave">
                  Aplicar crea un análisis nuevo con ese escenario. Este no cambia.
                </p>
              </div>
            ) : null}
          </div>
        ))}

        {pensando ? (
          <p className="text-sm text-texto-suave">Calculando…</p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo"
          >
            {error}
          </p>
        ) : null}

        <div ref={finRef} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            preguntar(pregunta);
          }}
          className="flex gap-2 pt-1"
        >
          <input
            value={pregunta}
            onChange={(e) => setPregunta(e.target.value)}
            placeholder="¿Y si el productor me sube el precio?"
            aria-label="Pregunta para el analista"
            disabled={pensando}
            className={CLASES_INPUT}
          />
          <button
            type="submit"
            disabled={pensando || pregunta.trim() === ""}
            className="flex-none rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-50"
          >
            Preguntar
          </button>
        </form>
      </div>

      <p className="max-w-prose text-xs leading-relaxed text-texto-suave">
        El analista interpreta; las cifras las calcula el motor. Aun así, esto es apoyo a la
        decisión y no asesoría financiera: verifique con su bróker antes de operar.
      </p>
    </section>
  );
}
