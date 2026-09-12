"use client";

import { useMemo, useState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import {
  admiteTextoDeOrden,
  textoOrdenBroker,
  usaOpciones,
  type VigenciaOrden,
} from "@/lib/engine/orden";
import type { EvaluacionEstrategia } from "@/lib/engine/index";
import type { TipoOperacion } from "@/lib/engine/tipos";

interface Props {
  evaluacion: EvaluacionEstrategia;
  simbolo: string;
  futuroReferenciaUsdTm: number;
  operacion: TipoOperacion;
  toneladas: number;
  /** Fecha de embarque o entrega, aaaa-mm-dd. */
  fechaEmbarque?: string;
}

/** Lee un número escrito a la colombiana; vacío o basura devuelve null. */
function leer(valor: string): number | null {
  const limpio = valor.trim().replace(/\s/g, "").replace(/[−]/g, "-");
  if (limpio === "") return null;
  const n = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Redacta la orden para el bróker y la deja lista para copiar.
 *
 * El cliente manda sus órdenes por WhatsApp a la mesa de StoneX. Ese
 * mensaje escrito a mano es el punto donde una cobertura correcta se
 * convierte en la operación contraria, así que aquí se arma con el
 * sentido y los contratos que salieron del análisis.
 *
 * Lo que NO hace: enviar. El texto se copia, se revisa y lo manda una
 * persona. Esa frontera es intencional.
 */
export function TextoOrden({
  evaluacion,
  simbolo,
  futuroReferenciaUsdTm,
  operacion,
  toneladas,
  fechaEmbarque,
}: Props) {
  const { estrategia } = evaluacion.resumen;

  const [cuenta, setCuenta] = useState("");
  const [limite, setLimite] = useState("");
  const [stop, setStop] = useState("");
  const [vigencia, setVigencia] = useState<VigenciaOrden>("gtc");
  const [copiado, setCopiado] = useState(false);

  const compra = estrategia.sentido === "larga";
  const conOpciones = usaOpciones(estrategia);

  const texto = useMemo(() => {
    if (!admiteTextoDeOrden(estrategia)) return null;
    return textoOrdenBroker({
      estrategia,
      simbolo,
      futuroReferenciaUsdTm,
      operacion,
      toneladas,
      fechaEmbarque,
      cuenta,
      precioLimiteUsdTm: conOpciones ? null : leer(limite),
      primaMaximaUsdTm: conOpciones ? leer(limite) : null,
      precioStopUsdTm: conOpciones ? null : leer(stop),
      vigencia,
      disparadorMargenUsdTm: evaluacion.margen?.precioDisparadorUsdTm ?? null,
    });
  }, [
    estrategia,
    simbolo,
    futuroReferenciaUsdTm,
    operacion,
    toneladas,
    fechaEmbarque,
    conOpciones,
    cuenta,
    limite,
    stop,
    vigencia,
    evaluacion.margen,
  ]);

  if (!texto) {
    return (
      <div className="rounded-lg border border-borde bg-superficie p-4">
        <h3 className="text-sm font-semibold">Texto para el bróker</h3>
        <p className="mt-1 text-xs leading-relaxed text-texto-suave">
          No cubrirse no requiere ninguna orden. Escoja otra estrategia arriba para
          obtener el texto.
        </p>
      </div>
    );
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles queda el texto a la vista para
      // seleccionarlo a mano; no vale la pena interrumpir con un error.
      setCopiado(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-borde bg-superficie p-4">
      <div>
        <h3 className="text-sm font-semibold">Texto para el bróker</h3>
        <p className="mt-1 text-xs leading-relaxed text-texto-suave">
          Listo para copiar y enviar por WhatsApp a su mesa.{" "}
          <strong className="font-semibold text-texto">Revíselo antes de mandarlo</strong>:
          esto es una orden con dinero detrás, y la herramienta no la envía por usted.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id="cuenta" etiqueta="Número de cuenta" ayuda="Su cuenta en la casa de bolsa.">
          <input
            id="cuenta"
            value={cuenta}
            onChange={(e) => setCuenta(e.target.value)}
            placeholder="Sin esto queda marcado [COMPLETAR]"
            className={CLASES_INPUT}
          />
        </Campo>

        <Campo
          id="limite"
          etiqueta={conOpciones ? "Prima máxima (USD/TM)" : "Precio límite (USD/TM)"}
          ayuda={
            conOpciones
              ? "Lo máximo que acepta pagar de prima. Vacío deja que la mesa cotice sin techo."
              : `Vacío usa el futuro de referencia del análisis, ${futuroReferenciaUsdTm.toLocaleString("es-CO", { maximumFractionDigits: 0 })}.`
          }
        >
          <input
            id="limite"
            inputMode="text"
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            placeholder={
              conOpciones
                ? "sin techo de prima"
                : futuroReferenciaUsdTm.toLocaleString("es-CO", { maximumFractionDigits: 0 })
            }
            className={CLASES_INPUT}
          />
        </Campo>

        {conOpciones ? null : (
        <Campo
          id="stop"
          etiqueta="Stop (USD/TM) — opcional"
          ayuda={`Déjelo vacío si no lo quiere. Un stop ${compra ? "por debajo" : "por encima"} liquidaría la cobertura justo cuando el físico se mueve en su contra, y lo dejaría descubierto.`}
        >
          <input
            id="stop"
            inputMode="text"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            placeholder="sin stop"
            className={CLASES_INPUT}
          />
        </Campo>
        )}

        <Campo id="vigencia" etiqueta="Vigencia">
          <select
            id="vigencia"
            value={vigencia}
            onChange={(e) => setVigencia(e.target.value as VigenciaOrden)}
            className={CLASES_INPUT}
          >
            <option value="gtc">Hasta cancelar (GTC)</option>
            <option value="dia">Solo por hoy (DAY)</option>
          </select>
        </Campo>
      </div>

      <div className="space-y-2">
        <pre className="whitespace-pre-wrap rounded-md border border-borde bg-fondo p-3 text-xs leading-relaxed">
          {texto}
        </pre>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={copiar}
            className="rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro"
          >
            {copiado ? "Copiado ✓" : "Copiar texto"}
          </button>
          <span className="text-xs text-texto-suave">
            {estrategia.nombre} · {estrategia.contratos} contrato
            {estrategia.contratos === 1 ? "" : "s"} · {estrategia.toneladasCubiertas} TM
          </span>
        </div>
      </div>
    </div>
  );
}
