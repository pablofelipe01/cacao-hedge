"use client";

import { useActionState, useState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import type { EstadoFormulario } from "@/lib/acciones/inventario";
import { crearVenta } from "@/lib/acciones/ventas";

const INICIAL: EstadoFormulario = {};

/** Registro de una venta cerrada, con las dos formas de pactar que usa el cliente. */
export function FormularioVenta() {
  const [estado, enviar, enviando] = useActionState(crearVenta, INICIAL);
  const [modalidad, setModalidad] = useState<"precio_pactado" | "por_fijar">("por_fijar");
  const [unidad, setUnidad] = useState<"porcentaje" | "usd_tm">("porcentaje");
  const [diferencial, setDiferencial] = useState("");
  const errores = estado.errores ?? {};

  return (
    <form action={enviar} className="space-y-5 rounded-lg border border-borde bg-superficie p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo id="comprador" etiqueta="Comprador" error={errores.comprador}>
          <input id="comprador" name="comprador" required placeholder="Barry Callebaut" className={CLASES_INPUT} />
        </Campo>

        <Campo id="toneladas" etiqueta="Toneladas métricas" error={errores.toneladas}>
          <input id="toneladas" name="toneladas" inputMode="decimal" required placeholder="50" className={CLASES_INPUT} />
        </Campo>

        <Campo
          id="fechaEmbarque"
          etiqueta="Fecha de embarque"
          ayuda="Con ella se decide en qué mes cuenta la venta y contra qué vencimiento se cubre."
          error={errores.fechaEmbarque}
        >
          <input id="fechaEmbarque" name="fechaEmbarque" type="date" required className={CLASES_INPUT} />
        </Campo>

        <Campo id="modalidad" etiqueta="¿Cómo se pactó el precio?" error={errores.modalidad}>
          <select
            id="modalidad"
            name="modalidad"
            value={modalidad}
            onChange={(e) => setModalidad(e.target.value as typeof modalidad)}
            className={CLASES_INPUT}
          >
            <option value="por_fijar">Contra Nueva York ± diferencial (se fija después)</option>
            <option value="precio_pactado">Precio cerrado en USD/TM</option>
          </select>
        </Campo>
      </div>

      {modalidad === "precio_pactado" ? (
        <Campo
          id="precioUsdTm"
          etiqueta="Precio pactado (USD/TM)"
          ayuda="El ingreso ya está cerrado: el riesgo es lo que falte por comprar para cumplirla."
          error={errores.precioUsdTm}
        >
          <input id="precioUsdTm" name="precioUsdTm" inputMode="decimal" placeholder="6.500" className={CLASES_INPUT} />
        </Campo>
      ) : (
        <Campo
          id="diferencial"
          etiqueta="Diferencial pactado"
          ayuda={
            unidad === "porcentaje"
              ? "En % del futuro de Nueva York. Negativo si vendió por debajo: −5 = 5 % bajo NY."
              : "En USD/TM sobre el futuro de Nueva York. Negativo si vendió por debajo."
          }
          error={errores.diferencial}
        >
          <div className="grid grid-cols-[1fr_7.5rem] gap-2">
            <input
              id="diferencial"
              name="diferencial"
              inputMode="text"
              placeholder={unidad === "porcentaje" ? "−5" : "−300"}
              value={diferencial}
              onChange={(e) => setDiferencial(e.target.value)}
              className={CLASES_INPUT}
            />
            {/* Cambiar de unidad borra el número: −300 USD/TM leído como
                −300 % es absurdo. */}
            <select
              name="unidadDiferencial"
              aria-label="Unidad del diferencial"
              value={unidad}
              onChange={(e) => {
                setUnidad(e.target.value as typeof unidad);
                setDiferencial("");
              }}
              className={CLASES_INPUT}
            >
              <option value="porcentaje">% de NY</option>
              <option value="usd_tm">USD/TM</option>
            </select>
          </div>
        </Campo>
      )}

      <Campo id="notas" etiqueta="Notas (opcional)">
        <textarea id="notas" name="notas" rows={2} className={CLASES_INPUT} />
      </Campo>

      {estado.mensaje ? (
        <p role="alert" className="text-sm text-negativo">
          {estado.mensaje}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
      >
        {enviando ? "Guardando…" : "Registrar venta"}
      </button>
    </form>
  );
}
