"use client";

import { useState, useTransition } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { registrarCasoComoVentas, simularHipotetico, type RespuestaSimulacion } from "@/lib/acciones/simulador";
import { interpretarNumero } from "@/lib/acciones/esquemas";
import { generarEntregas } from "@/lib/engine/simulador";
import type { EntradaCaso } from "@/lib/simulador/entrada";
import { AnalistaSimulador } from "./AnalistaSimulador";
import { ResultadoSimulacion } from "./ResultadoSimulacion";

interface Props {
  hoy: string;
  descuentoMedidoPct: number | null;
  descuentoPorDefectoPct: number;
  primeraEntrega: string;
}

/** El formulario guarda texto: es lo que el usuario escribe, con sus puntos y comas. */
interface Formulario {
  comprador: string;
  precio: string;
  total: string;
  porEntrega: string;
  primera: string;
  cadaDias: string;
  entregas: { fecha: string; toneladas: string }[];
  descuento: string;
  diasCompra: string;
  anticipo: string;
  diasAnticipo: string;
  diasSaldo: string;
  costos: string;
  /** En millones de pesos: nadie escribe nueve ceros sin equivocarse. */
  capitalMillones: string;
}

const texto = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 3 });

function formularioDesdeEntrada(e: EntradaCaso, anterior: Formulario): Formulario {
  const total = e.entregas.reduce((a, x) => a + x.toneladas, 0);
  return {
    ...anterior,
    comprador: e.comprador,
    precio: texto(e.precioVentaUsdTm),
    total: texto(total),
    porEntrega: texto(Math.max(...e.entregas.map((x) => x.toneladas))),
    primera: e.entregas[0]?.fecha ?? anterior.primera,
    entregas: e.entregas.map((x) => ({ fecha: x.fecha, toneladas: texto(x.toneladas) })),
    descuento: texto(e.descuentoCompraPct),
    diasCompra: texto(e.diasCompraAntes),
    anticipo: texto(e.anticipoPct),
    diasAnticipo: texto(e.diasAnticipoAntes),
    diasSaldo: texto(e.diasSaldoDespues),
    costos: texto(e.costosUsdTm),
    capitalMillones: texto(e.capitalCop / 1e6),
  };
}

function repartir(f: Formulario): { fecha: string; toneladas: string }[] {
  return generarEntregas(
    interpretarNumero(f.total),
    interpretarNumero(f.porEntrega),
    f.primera,
    interpretarNumero(f.cadaDias),
  ).map((e) => ({ fecha: e.fecha, toneladas: texto(e.toneladas) }));
}

/**
 * Traduce el formulario a la entrada del motor. Los números vacíos van
 * como NaN y los rechaza la validación del servidor con su mensaje.
 */
function entradaDesdeFormulario(f: Formulario): EntradaCaso {
  const n = (v: string, siVacio?: number) => (v.trim() === "" && siVacio !== undefined ? siVacio : interpretarNumero(v));
  const entregas = f.entregas.length > 0 ? f.entregas : repartir(f);
  return {
    comprador: f.comprador.trim(),
    precioVentaUsdTm: n(f.precio),
    entregas: entregas.map((e) => ({ fecha: e.fecha, toneladas: n(e.toneladas) })),
    descuentoCompraPct: n(f.descuento),
    diasCompraAntes: n(f.diasCompra, 0),
    anticipoPct: n(f.anticipo, 0),
    diasAnticipoAntes: n(f.diasAnticipo, 0),
    diasSaldoDespues: n(f.diasSaldo, 0),
    costosUsdTm: n(f.costos, 0),
    capitalCop: n(f.capitalMillones) * 1e6,
  };
}

/**
 * El simulador: formulario, resultado y analista.
 *
 * El formulario es la fuente del caso. El chat no calcula por su cuenta
 * sobre otra cosa: arma casos, y el que el usuario elija se carga aquí y
 * se recalcula con la misma acción que el botón.
 */
export function Simulador({ hoy, descuentoMedidoPct, descuentoPorDefectoPct, primeraEntrega }: Props) {
  const [f, setF] = useState<Formulario>({
    comprador: "",
    precio: "",
    total: "",
    porEntrega: "",
    primera: primeraEntrega,
    cadaDias: "15",
    entregas: [],
    descuento: texto(descuentoPorDefectoPct),
    diasCompra: "10",
    anticipo: "50",
    diasAnticipo: "10",
    diasSaldo: "7",
    costos: "",
    capitalMillones: "",
  });
  const [respuesta, setRespuesta] = useState<RespuestaSimulacion | null>(null);
  /** La entrada con que se calculó lo que está en pantalla. */
  const [calculada, setCalculada] = useState<EntradaCaso | null>(null);
  const [calculando, iniciar] = useTransition();
  const [registro, setRegistro] = useState<string | null>(null);
  const [registrando, iniciarRegistro] = useTransition();

  const poner = (campo: keyof Formulario) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((previo) => ({ ...previo, [campo]: e.target.value }));

  const calcular = (entrada: EntradaCaso) => {
    setRegistro(null);
    iniciar(async () => {
      const r = await simularHipotetico(entrada);
      setRespuesta(r);
      setCalculada(r.ok ? entrada : null);
    });
  };

  const cargarDelChat = (entrada: EntradaCaso) => {
    setF((previo) => formularioDesdeEntrada(entrada, previo));
    calcular(entrada);
    requestAnimationFrame(() => document.getElementById("caso")?.scrollIntoView({ behavior: "smooth" }));
  };

  const registrar = () => {
    if (!calculada) return;
    iniciarRegistro(async () => {
      const r = await registrarCasoComoVentas({ ...calculada, comprador: f.comprador.trim() });
      setRegistro(
        r.ok
          ? `Listo: ${r.ventas} venta(s) a precio cerrado en Ventas. Desde ahora cuentan en la posición.`
          : r.errores.join(" "),
      );
    });
  };

  const totalEntregas = f.entregas.reduce((a, e) => a + (interpretarNumero(e.toneladas) || 0), 0);

  return (
    <div className="space-y-8">
      <form
        id="caso"
        onSubmit={(e) => {
          e.preventDefault();
          const entrada = entradaDesdeFormulario(f);
          if (f.entregas.length === 0) setF((p) => ({ ...p, entregas: repartir(p) }));
          calcular(entrada);
        }}
        className="space-y-6 rounded-lg border border-borde bg-superficie p-5"
      >
        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">La venta</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo id="precio" etiqueta="Precio fijo de venta (USD/TM)">
              <input id="precio" value={f.precio} onChange={poner("precio")} inputMode="decimal" placeholder="6.500" className={CLASES_INPUT} required />
            </Campo>
            <Campo id="costos" etiqueta="Costos hasta puerto (USD/TM)" ayuda="Secado, transporte, puerto… Vacío = 0.">
              <input id="costos" value={f.costos} onChange={poner("costos")} inputMode="decimal" placeholder="150" className={CLASES_INPUT} />
            </Campo>
            <Campo id="comprador" etiqueta="Comprador (opcional)" ayuda="Solo para registrarla si se concreta.">
              <input id="comprador" value={f.comprador} onChange={poner("comprador")} className={CLASES_INPUT} />
            </Campo>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">Entregas en puerto</legend>
          <div className="grid gap-4 sm:grid-cols-4">
            <Campo id="total" etiqueta="Toneladas en total">
              <input id="total" value={f.total} onChange={poner("total")} inputMode="decimal" placeholder="300" className={CLASES_INPUT} />
            </Campo>
            <Campo id="porEntrega" etiqueta="Toneladas por entrega">
              <input id="porEntrega" value={f.porEntrega} onChange={poner("porEntrega")} inputMode="decimal" placeholder="60" className={CLASES_INPUT} />
            </Campo>
            <Campo id="primera" etiqueta="Primera entrega">
              <input id="primera" type="date" min={hoy} value={f.primera} onChange={poner("primera")} className={CLASES_INPUT} />
            </Campo>
            <Campo id="cadaDias" etiqueta="Cada cuántos días">
              <input id="cadaDias" value={f.cadaDias} onChange={poner("cadaDias")} inputMode="numeric" className={CLASES_INPUT} />
            </Campo>
          </div>
          <button
            type="button"
            onClick={() => setF((p) => ({ ...p, entregas: repartir(p) }))}
            className="rounded-md border border-borde px-3 py-1.5 text-sm transition hover:border-cacao"
          >
            {f.entregas.length > 0 ? "Volver a repartir" : "Repartir en entregas"}
          </button>

          {f.entregas.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-texto-suave">
                Puede ajustar cada entrega: una de 50 y otra de 75, una fecha que se corre. En total{" "}
                <span className="tabular">{texto(totalEntregas)}</span> TM.
              </p>
              <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {f.entregas.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-5 flex-none text-right text-xs text-texto-suave">{i + 1}</span>
                    <input
                      type="date"
                      aria-label={`Fecha de la entrega ${i + 1}`}
                      value={e.fecha}
                      onChange={(ev) =>
                        setF((p) => ({ ...p, entregas: p.entregas.map((x, j) => (j === i ? { ...x, fecha: ev.target.value } : x)) }))
                      }
                      className={CLASES_INPUT}
                    />
                    <input
                      aria-label={`Toneladas de la entrega ${i + 1}`}
                      value={e.toneladas}
                      inputMode="decimal"
                      onChange={(ev) =>
                        setF((p) => ({ ...p, entregas: p.entregas.map((x, j) => (j === i ? { ...x, toneladas: ev.target.value } : x)) }))
                      }
                      className={`${CLASES_INPUT} w-20 flex-none`}
                    />
                    <button
                      type="button"
                      aria-label={`Quitar la entrega ${i + 1}`}
                      onClick={() => setF((p) => ({ ...p, entregas: p.entregas.filter((_x, j) => j !== i) }))}
                      className="flex-none px-1 text-texto-suave hover:text-negativo"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">Compra y pagos</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo
              id="descuento"
              etiqueta="Compra al productor (% de NY)"
              ayuda={
                descuentoMedidoPct != null
                  ? `El habitual medido es ${texto(descuentoMedidoPct)} %. Negativo = por debajo de NY.`
                  : "Sin precios del productor sincronizados. Negativo = por debajo de NY."
              }
            >
              <input id="descuento" value={f.descuento} onChange={poner("descuento")} inputMode="text" className={CLASES_INPUT} />
            </Campo>
            <Campo id="diasCompra" etiqueta="Compra el cacao… días antes de cada entrega" ayuda="Ese día le paga al productor.">
              <input id="diasCompra" value={f.diasCompra} onChange={poner("diasCompra")} inputMode="numeric" className={CLASES_INPUT} />
            </Campo>
            <Campo id="capital" etiqueta="Capital de trabajo (millones de COP)" ayuda="Lo que tiene disponible hoy para esta operación.">
              <input id="capital" value={f.capitalMillones} onChange={poner("capitalMillones")} inputMode="decimal" placeholder="2.000" className={CLASES_INPUT} required />
            </Campo>
            <Campo id="anticipo" etiqueta="Anticipo con cada orden (%)">
              <input id="anticipo" value={f.anticipo} onChange={poner("anticipo")} inputMode="decimal" className={CLASES_INPUT} />
            </Campo>
            <Campo id="diasAnticipo" etiqueta="Llega… días antes de la entrega" ayuda="Cuando le emiten la orden.">
              <input id="diasAnticipo" value={f.diasAnticipo} onChange={poner("diasAnticipo")} inputMode="numeric" className={CLASES_INPUT} />
            </Campo>
            <Campo id="diasSaldo" etiqueta="El saldo llega… días después de entregar" ayuda="Contra documentos de entrega en puerto.">
              <input id="diasSaldo" value={f.diasSaldo} onChange={poner("diasSaldo")} inputMode="numeric" className={CLASES_INPUT} />
            </Campo>
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={calculando}
          className="w-full rounded-md bg-cacao px-4 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
        >
          {calculando ? "Simulando…" : "Simular el caso"}
        </button>
      </form>

      {respuesta && !respuesta.ok ? (
        <ul role="alert" className="space-y-1 rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo">
          {respuesta.errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      {respuesta?.ok ? (
        <div className={calculando ? "opacity-60 transition-opacity" : undefined}>
          <ResultadoSimulacion respuesta={respuesta} />
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-borde bg-superficie px-4 py-3">
            <p className="flex-1 text-sm text-texto-suave">
              ¿Se concretó? Regístrela: cada entrega pasa a Ventas como venta a precio cerrado y
              empieza a contar en la posición.
            </p>
            <button
              type="button"
              onClick={registrar}
              disabled={registrando || !f.comprador.trim()}
              title={f.comprador.trim() ? undefined : "Escriba el comprador arriba"}
              className="rounded-md border border-cacao px-3 py-1.5 text-sm text-cacao transition hover:bg-cacao hover:text-white disabled:opacity-50"
            >
              {registrando ? "Registrando…" : "Registrar como venta real"}
            </button>
            {registro ? <p className="w-full text-sm" role="status">{registro}</p> : null}
          </div>
        </div>
      ) : null}

      <AnalistaSimulador entradaActual={calculada} onCargar={cargarDelChat} />
    </div>
  );
}
