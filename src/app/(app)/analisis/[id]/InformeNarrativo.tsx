"use client";

import { useActionState } from "react";

import { Markdown } from "@/components/Markdown";
import { generarInformeNarrativo, type EstadoInforme } from "@/lib/acciones/informe";

interface Verificacion {
  totalCitadas: number;
  rastreables: number;
  limpio: boolean;
  sospechosas: { textual: string; contexto: string }[];
}

interface Props {
  analisisId: string;
  informe: string | null;
  meta: { modelo?: string; generadoEn?: string; verificacion?: Verificacion } | null;
}

const INICIAL: EstadoInforme = {};

export function InformeNarrativo({ analisisId, informe, meta }: Props) {
  const [estado, enviar, generando] = useActionState(generarInformeNarrativo, INICIAL);
  const verificacion = meta?.verificacion;

  return (
    <section aria-labelledby="informe" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="informe" className="text-sm font-semibold">
          Informe ejecutivo
        </h2>

        <div className="flex gap-2 print:hidden">
          {informe ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-borde px-3 py-1.5 text-sm transition hover:border-cacao"
            >
              Exportar PDF
            </button>
          ) : null}

          <form action={enviar}>
            <input type="hidden" name="id" value={analisisId} />
            <button
              type="submit"
              disabled={generando}
              className="rounded-md bg-cacao px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60"
            >
              {generando
                ? "Redactando…"
                : informe
                  ? "Regenerar informe"
                  : "Generar informe"}
            </button>
          </form>
        </div>
      </div>

      {estado.error ? (
        <p role="alert" className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          {estado.error}
        </p>
      ) : null}

      {!informe ? (
        <div className="rounded-lg border border-dashed border-borde bg-superficie px-4 py-8 text-center print:hidden">
          <p className="text-sm text-texto-suave">
            Todavía no hay informe. Al generarlo, un modelo de lenguaje interpreta y
            redacta <strong>a partir de las cifras ya calculadas</strong>: no hace
            ningún cálculo propio.
          </p>
        </div>
      ) : (
        <article className="rounded-lg border border-borde bg-superficie p-5 print:border-0 print:p-0">
          <Markdown texto={informe} />

          <footer className="mt-6 border-t border-borde pt-3 text-xs text-texto-suave">
            {verificacion ? (
              <p className={verificacion.limpio ? "" : "text-ambar"}>
                {verificacion.limpio ? (
                  <>
                    <strong className="font-semibold">Cifras verificadas:</strong> las{" "}
                    {verificacion.totalCitadas} cifras citadas corresponden a valores
                    del análisis. Ninguna fue inventada por el modelo.
                  </>
                ) : (
                  <>
                    <strong className="font-semibold">Atención:</strong>{" "}
                    {verificacion.sospechosas.length} de {verificacion.totalCitadas}{" "}
                    cifras del informe no se pudieron rastrear a los datos del análisis
                    ({verificacion.sospechosas.map((s) => s.textual).join(", ")}).
                    Contrástelas con la tabla antes de usarlas.
                  </>
                )}
              </p>
            ) : null}

            <p className="mt-1">
              {/* El formato español termina en «p. m.», que ya lleva punto:
                  añadir otro produce «p. m..». */}
              Redactado por {meta?.modelo ?? "un modelo de lenguaje"}
              {meta?.generadoEn
                ? ` el ${new Date(meta.generadoEn).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}`
                : ""}
              {" · "}
              Todas las cifras provienen del motor de cálculo, no del modelo.
            </p>
          </footer>
        </article>
      )}
    </section>
  );
}
