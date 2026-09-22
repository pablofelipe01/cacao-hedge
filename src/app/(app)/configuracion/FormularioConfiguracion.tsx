"use client";

import { useActionState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { guardarConfiguracion } from "@/lib/acciones/configuracion";
import type { EstadoFormulario } from "@/lib/acciones/inventario";

interface Valores {
  margenInicialUsd: number;
  margenMantenimientoUsd: number;
  comisionUsdContrato: number;
  tasaLibreRiesgoPorcentaje: number;
  volFallbackPorcentaje: number;
  diasHabilesAnio: number;
  nivelConfianzaVarPorcentaje: number;
  trayectoriasMc: number;
}

const INICIAL: EstadoFormulario = {};

/**
 * Escribe el valor por defecto en convención colombiana.
 *
 * Sin esto el navegador rellena «4.25» (punto decimal de JavaScript) en un
 * formulario cuyo resto de valores el usuario escribe con coma: el propio
 * campo enseñaba un formato que luego no era el esperado.
 */
function comaDecimal(valor: number): string {
  return valor.toLocaleString("es-CO", { maximumFractionDigits: 4, useGrouping: false });
}

export function FormularioConfiguracion({ valores }: { valores: Valores }) {
  const [estado, enviar, guardando] = useActionState(guardarConfiguracion, INICIAL);
  const errores = estado.errores ?? {};

  return (
    <form action={enviar} className="space-y-6">
      <fieldset className="space-y-5 rounded-lg border border-borde bg-superficie p-5">
        <legend className="px-1 text-sm font-semibold">Bróker y márgenes</legend>
        <p className="text-xs leading-relaxed text-texto-suave">
          ICE ajusta el margen del CC con frecuencia — en 2024 superó los 20.000 USD por
          contrato. Estos valores <strong>no se consultan en vivo</strong>: confírmelos
          con su bróker y actualícelos aquí.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            id="margenInicialUsd"
            etiqueta="Margen inicial (USD/contrato)"
            ayuda="Capital que inmoviliza al abrir la posición."
            error={errores.margenInicialUsd}
          >
            <input
              id="margenInicialUsd"
              name="margenInicialUsd"
              inputMode="decimal"
              defaultValue={comaDecimal(valores.margenInicialUsd)}
              required
              className={CLASES_INPUT}
            />
          </Campo>

          <Campo
            id="comisionUsdContrato"
            etiqueta="Comisión (USD/contrato)"
            ayuda="Ida y vuelta."
            error={errores.comisionUsdContrato}
          >
            <input
              id="comisionUsdContrato"
              name="comisionUsdContrato"
              inputMode="decimal"
              defaultValue={comaDecimal(valores.comisionUsdContrato)}
              required
              className={CLASES_INPUT}
            />
          </Campo>

          <Campo
            id="tasaLibreRiesgoPorcentaje"
            etiqueta="Tasa libre de riesgo (% anual)"
            ayuda="Descuenta las primas de las opciones (Black-76)."
            error={errores.tasaLibreRiesgoPorcentaje}
          >
            <input
              id="tasaLibreRiesgoPorcentaje"
              name="tasaLibreRiesgoPorcentaje"
              inputMode="decimal"
              defaultValue={comaDecimal(valores.tasaLibreRiesgoPorcentaje)}
              required
              className={CLASES_INPUT}
            />
          </Campo>
        </div>

        {/* No se pide: se deriva al guardar. Se muestra para que la cifra
            que dispara las llamadas de margen no sea invisible. */}
        <p className="text-xs leading-relaxed text-texto-suave">
          Margen de mantenimiento:{" "}
          <span className="tabular font-medium text-texto">
            {valores.margenMantenimientoUsd.toLocaleString("es-CO", { maximumFractionDigits: 2 })}{" "}
            USD/contrato
          </span>
          . No hace falta escribirlo: se calcula solo, como el inicial dividido entre
          1,1, que es la relación que usa ICE. Por debajo de ese nivel llega la llamada de
          margen.
        </p>
      </fieldset>

      <fieldset className="space-y-5 rounded-lg border border-borde bg-superficie p-5">
        <legend className="px-1 text-sm font-semibold">Riesgo y simulación</legend>

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            id="nivelConfianzaVarPorcentaje"
            etiqueta="Nivel de confianza del VaR (%)"
            ayuda="95 % reporta la cola del peor 5 %."
            error={errores.nivelConfianzaVarPorcentaje}
          >
            <input
              id="nivelConfianzaVarPorcentaje"
              name="nivelConfianzaVarPorcentaje"
              inputMode="decimal"
              defaultValue={comaDecimal(valores.nivelConfianzaVarPorcentaje)}
              required
              className={CLASES_INPUT}
            />
          </Campo>

          <Campo
            id="trayectoriasMc"
            etiqueta="Trayectorias Monte Carlo"
            ayuda="Más trayectorias, menos ruido y más tiempo de cálculo."
            error={errores.trayectoriasMc}
          >
            <input
              id="trayectoriasMc"
              name="trayectoriasMc"
              inputMode="numeric"
              defaultValue={valores.trayectoriasMc}
              required
              className={CLASES_INPUT}
            />
          </Campo>

          <Campo
            id="volFallbackPorcentaje"
            etiqueta="Volatilidad de respaldo del cacao (% anual)"
            ayuda="Solo se usa si la serie histórica no alcanza para estimarla."
            error={errores.volFallbackPorcentaje}
          >
            <input
              id="volFallbackPorcentaje"
              name="volFallbackPorcentaje"
              inputMode="decimal"
              defaultValue={comaDecimal(valores.volFallbackPorcentaje)}
              required
              className={CLASES_INPUT}
            />
          </Campo>

          <Campo
            id="diasHabilesAnio"
            etiqueta="Días hábiles bursátiles al año"
            ayuda="Base para anualizar la volatilidad. 252 es el estándar."
            error={errores.diasHabilesAnio}
          >
            <input
              id="diasHabilesAnio"
              name="diasHabilesAnio"
              inputMode="numeric"
              defaultValue={valores.diasHabilesAnio}
              required
              className={CLASES_INPUT}
            />
          </Campo>
        </div>
      </fieldset>

      {estado.mensaje ? (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            estado.mensaje.startsWith("No se pudo")
              ? "border-negativo/40 bg-negativo/5 text-negativo"
              : "border-positivo/40 bg-positivo/5 text-positivo"
          }`}
        >
          {estado.mensaje}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={guardando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
      >
        {guardando ? "Guardando…" : "Guardar supuestos"}
      </button>
    </form>
  );
}
