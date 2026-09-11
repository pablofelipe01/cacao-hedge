"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { CLASES_INPUT, Campo } from "@/components/Campo";
import { ejecutarAnalisis } from "@/lib/acciones/analisis";
import type { EstadoFormulario } from "@/lib/acciones/inventario";
import type { SerieDisponible } from "@/lib/data/cache";
import { CC_TONELADAS_POR_CONTRATO } from "@/lib/engine/constantes";
import { toneladas as fmtToneladas, usdTm } from "@/lib/formato";

interface Lote {
  id: string;
  nombre: string;
  toneladas: number;
  costo_cop_kg: number;
  fecha_embarque: string;
  diferencial_usd_tm: number;
  tipo_contrato: string;
  precio_venta_usd_tm: number | null;
}

interface Bodega {
  lotes: number;
  toneladas: number;
  costoCopKg: number | null;
  kgConCostoPorcentaje: number;
}

interface Props {
  lotes: Lote[];
  loteInicial: string | null;
  series: SerieDisponible[];
  bodega: Bodega;
  desdeUrl: { toneladas: string | null; costoCopKg: string | null };
}

const INICIAL: EstadoFormulario = {};

const NOMBRE_FUENTE: Record<string, string> = {
  yahoo: "continuo de Yahoo",
  barchart_api: "Barchart OnDemand",
  barchart_csv: "CSV importado",
  manual: "carga manual",
};

type Situacion = "tengo_cacao" | "ya_vendi";

/**
 * Las etiquetas cambian con la situación, no solo por cortesía.
 *
 * Las mismas casillas significan cosas opuestas en cada caso: el
 * diferencial es lo que le PAGAN sobre la bolsa cuando vende su
 * inventario, y lo que él PAGA al productor cuando debe abastecerse. Un
 * signo mal entendido aquí mueve el análisis entero.
 */
const TEXTOS: Record<Situacion, {
  pasoCantidad: string;
  toneladas: string;
  ayudaToneladas: string;
  placeholderToneladas: string;
  pasoOperacion: string;
  fecha: string;
  ayudaFecha: string;
  diferencial: string;
  ayudaDiferencial: string;
  placeholderDiferencial: string;
  diferencialPct: string;
  ayudaDiferencialPct: string;
  placeholderDiferencialPct: string;
  precio: string;
  ayudaPrecio: string;
}> = {
  tengo_cacao: {
    pasoCantidad: "2 · ¿Cuánto cacao?",
    toneladas: "Toneladas métricas",
    ayudaToneladas: "Lo que tiene en bodega y quiere proteger.",
    placeholderToneladas: "15,275",
    pasoOperacion: "3 · Su operación",
    fecha: "Fecha de embarque",
    ayudaFecha:
      "Cuándo sale el contenedor. Marca el horizonte del riesgo y el vencimiento de las opciones.",
    diferencial: "Diferencial sobre Nueva York (USD/TM)",
    ayudaDiferencial:
      "La prima o descuento de SU cacao frente al futuro: positivo si le pagan por encima de la bolsa, negativo (−250) si por debajo. La cobertura NO fija este número.",
    placeholderDiferencial: "250",
    diferencialPct: "Diferencial sobre Nueva York (% del futuro)",
    ayudaDiferencialPct:
      "Si le pagan un porcentaje del cierre de Nueva York. Positivo si por encima, negativo (−10) si por debajo.",
    placeholderDiferencialPct: "5",
    precio: "Precio pactado (USD/TM)",
    ayudaPrecio:
      "Con el precio cerrado el riesgo de mercado ya no existe: lo que queda vivo es el cambiario.",
  },
  ya_vendi: {
    pasoCantidad: "2 · ¿Cuánto cacao le falta comprar?",
    toneladas: "Toneladas métricas por comprar",
    ayudaToneladas:
      "Solo lo que todavía no tiene. Lo que ya está en bodega no corre riesgo de precio: ya lo pagó.",
    // Deliberadamente distinto del total de bodega: aquí va el faltante,
    // y repetir la cifra de arriba invitaría a copiarla sin pensar.
    placeholderToneladas: "40",
    pasoOperacion: "3 · La venta que ya cerró",
    fecha: "Fecha de entrega",
    ayudaFecha:
      "Cuándo debe entregar. Marca hasta cuándo corre el riesgo de que el cacao suba de precio.",
    diferencial: "Diferencia entre lo que paga al productor y Nueva York (USD/TM)",
    ayudaDiferencial:
      "Futuro + diferencial = lo que le cuesta el físico. Comprar en Colombia por DEBAJO de la bolsa es lo normal: escríbalo con signo menos (−300). Positivo solo si paga prima sobre el futuro. La cobertura NO fija este número: es su riesgo de base.",
    placeholderDiferencial: "-300",
    diferencialPct: "Cuánto por debajo de Nueva York le compra al productor (%)",
    ayudaDiferencialPct:
      "Si el precio se pacta como porcentaje del cierre del día —lo habitual en Colombia—, escríbalo con signo menos: −23,5 significa comprar un 23,5 % por debajo de la bolsa. Cambia cuánto hay que cubrir: con un descuento porcentual usted solo está expuesto a (100 − 23,5) % del movimiento del precio.",
    placeholderDiferencialPct: "-23,5",
    precio: "Precio al que cerró la venta (USD/TM)",
    ayudaPrecio:
      "El ingreso ya está fijo en este número. Todo el análisis mide qué tanto del margen se le come el costo de abastecerse.",
  },
};

interface Campos {
  inventarioId: string;
  toneladas: string;
  costoCopKg: string;
  fechaEmbarque: string;
  diferencialUsdTm: string;
  modoDiferencial: "absoluto" | "porcentual";
  tipoContrato: string;
  precioVentaUsdTm: string;
}

const VACIO: Campos = {
  inventarioId: "",
  toneladas: "",
  costoCopKg: "",
  fechaEmbarque: "",
  diferencialUsdTm: "",
  modoDiferencial: "absoluto",
  tipoContrato: "sin_contrato",
  precioVentaUsdTm: "",
};

function desdeLote(lote: Lote | undefined): Campos {
  if (!lote) return VACIO;
  return {
    inventarioId: lote.id,
    toneladas: String(lote.toneladas),
    costoCopKg: String(lote.costo_cop_kg),
    fechaEmbarque: lote.fecha_embarque,
    diferencialUsdTm: String(lote.diferencial_usd_tm),
    modoDiferencial: "absoluto",
    tipoContrato: lote.tipo_contrato,
    precioVentaUsdTm: lote.precio_venta_usd_tm != null ? String(lote.precio_venta_usd_tm) : "",
  };
}

export function FormularioAnalisis({ lotes, loteInicial, series, bodega, desdeUrl }: Props) {
  const [estado, enviar, enviando] = useActionState(ejecutarAnalisis, INICIAL);
  const [situacion, setSituacion] = useState<Situacion>("tengo_cacao");
  const [campos, setCampos] = useState<Campos>(() => {
    const base = desdeLote(lotes.find((l) => l.id === loteInicial));
    return {
      ...base,
      toneladas: desdeUrl.toneladas ?? base.toneladas,
      costoCopKg: desdeUrl.costoCopKg ?? base.costoCopKg,
    };
  });

  const errores = estado.errores ?? {};
  const t = TEXTOS[situacion];
  const esInventario = situacion === "tengo_cacao";

  const actualizar = (parcial: Partial<Campos>) =>
    setCampos((previo) => ({ ...previo, ...parcial }));

  const usarBodega = () =>
    actualizar({
      inventarioId: "",
      toneladas: bodega.toneladas.toFixed(4),
      costoCopKg: bodega.costoCopKg ? String(Math.round(bodega.costoCopKg)) : campos.costoCopKg,
    });

  const contratos = Number(campos.toneladas.replace(",", ".")) / CC_TONELADAS_POR_CONTRATO;

  // Quien ya vendió tiene el precio cerrado por definición: no es una
  // elección suya, así que el selector no aparece y el valor viaja fijo.
  const esPorcentual = campos.modoDiferencial === "porcentual";
  const tipoContrato = esInventario ? campos.tipoContrato : "precio_fijo_usd";
  const pidePrecio = tipoContrato === "precio_fijo_usd";

  return (
    <form action={enviar} className="space-y-6">
      <input type="hidden" name="inventarioId" value={esInventario ? campos.inventarioId : ""} />
      <input type="hidden" name="situacion" value={situacion} />

      {/* --- Paso 1: qué caso es. Decide el sentido de la cobertura. --- */}
      <fieldset className="space-y-3 rounded-lg border border-borde bg-superficie p-5">
        <legend className="px-1 text-sm font-semibold">1 · ¿En qué situación está?</legend>
        <p className="text-xs leading-relaxed text-texto-suave">
          De esto depende todo: el riesgo va en un sentido o en el contrario, y la
          cobertura también.
        </p>

        <div className="space-y-2">
          {[
            {
              valor: "tengo_cacao" as const,
              titulo: "Tengo el cacao y aún no lo he vendido",
              detalle:
                "El riesgo es que el precio BAJE: tendría que venderlo por menos de lo que costó. Se cubre vendiendo futuros.",
            },
            {
              valor: "ya_vendi" as const,
              titulo: "Ya vendí a precio cerrado y me falta comprar el cacao",
              detalle:
                "El riesgo es que el precio SUBA: tendría que comprarlo más caro de lo que lo vendió. Se cubre comprando futuros.",
            },
          ].map((opcion) => (
            <label
              key={opcion.valor}
              className={`flex cursor-pointer gap-3 rounded-md border p-3 transition ${
                situacion === opcion.valor
                  ? "border-cacao bg-cacao/5"
                  : "border-borde hover:border-cacao-claro"
              }`}
            >
              <input
                type="radio"
                name="situacionVisible"
                checked={situacion === opcion.valor}
                onChange={() => setSituacion(opcion.valor)}
                className="mt-1 accent-[var(--cacao)]"
              />
              <span>
                <span className="block text-sm font-medium">{opcion.titulo}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-texto-suave">
                  {opcion.detalle}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* --- Paso 2: cuánto. Sale de la bodega si está sincronizada. --- */}
      <fieldset className="space-y-4 rounded-lg border border-borde bg-superficie p-5">
        <legend className="px-1 text-sm font-semibold">{t.pasoCantidad}</legend>

        {bodega.lotes > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-borde bg-fondo p-3">
            <div>
              <p className="text-sm">
                En bodega tiene{" "}
                <span className="tabular font-semibold">
                  {fmtToneladas(bodega.toneladas)} TM
                </span>{" "}
                <span className="text-texto-suave">en {bodega.lotes} lotes</span>
              </p>
              <p className="mt-0.5 text-xs text-texto-suave">
                {esInventario
                  ? bodega.costoCopKg
                    ? `Costo ponderado ${usdTm(bodega.costoCopKg)} COP/kg sobre el ${(bodega.kgConCostoPorcentaje * 100).toFixed(0)} % de los kilos.`
                    : "Ningún lote declara precio de compra en la hoja."
                  : "Ese cacao ya está pagado: descuéntelo de lo que debe entregar y ponga abajo solo el faltante."}
              </p>
            </div>
            {esInventario ? (
              <button
                type="button"
                onClick={usarBodega}
                className="rounded-md border border-cacao px-3 py-1.5 text-sm text-cacao transition hover:bg-cacao hover:text-white"
              >
                Usar todo
              </button>
            ) : null}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-borde px-3 py-2 text-xs text-texto-suave">
            No hay inventario sincronizado.{" "}
            <Link href="/bodega" className="text-cacao hover:underline">
              Traerlo de la hoja
            </Link>{" "}
            {esInventario
              ? "rellena la cantidad y el costo automáticamente."
              : "le dice cuánto cacao ya tiene y cuánto le falta comprar."}
          </p>
        )}

        {esInventario && lotes.length > 0 ? (
          <Campo id="lote" etiqueta="O partir de un lote guardado">
            <select
              id="lote"
              value={campos.inventarioId}
              onChange={(e) => setCampos(desdeLote(lotes.find((l) => l.id === e.target.value)))}
              className={CLASES_INPUT}
            >
              <option value="">Sin lote</option>
              {lotes.map((lote) => (
                <option key={lote.id} value={lote.id}>
                  {lote.nombre} · {lote.toneladas} TM
                </option>
              ))}
            </select>
          </Campo>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            id="toneladas"
            etiqueta={t.toneladas}
            ayuda={
              Number.isFinite(contratos) && contratos > 0
                ? `${t.ayudaToneladas} Equivale a ${contratos.toLocaleString("es-CO", { maximumFractionDigits: 2 })} contratos CC de 10 TM.`
                : `${t.ayudaToneladas} Un contrato CC cubre exactamente 10 TM.`
            }
            error={errores.toneladas}
          >
            <input
              id="toneladas"
              name="toneladas"
              inputMode="decimal"
              required
              placeholder={t.placeholderToneladas}
              value={campos.toneladas}
              onChange={(e) => actualizar({ toneladas: e.target.value })}
              className={CLASES_INPUT}
            />
          </Campo>

          {esInventario ? (
            <Campo
              id="costoCopKg"
              etiqueta="Costo de adquisición (COP/kg)"
              ayuda="Lo que le costó el kilo puesto en bodega. Define su punto de equilibrio."
              error={errores.costoCopKg}
            >
              <input
                id="costoCopKg"
                name="costoCopKg"
                inputMode="decimal"
                required
                placeholder="16.468"
                value={campos.costoCopKg}
                onChange={(e) => actualizar({ costoCopKg: e.target.value })}
                className={CLASES_INPUT}
              />
            </Campo>
          ) : (
            /* Este cacao todavía no se ha comprado: no hay costo que declarar,
               y pedirlo invitaría a inventar el número que el análisis busca. */
            <p className="self-end rounded-md border border-dashed border-borde px-3 py-2 text-xs leading-relaxed text-texto-suave">
              No le pedimos el costo del cacao: todavía no lo ha comprado. Cuánto le
              costará es justamente lo que calcula este análisis.
            </p>
          )}
        </div>
      </fieldset>

      {/* --- Paso 3: lo que la hoja no sabe: decisiones comerciales. --- */}
      <fieldset className="space-y-4 rounded-lg border border-borde bg-superficie p-5">
        <legend className="px-1 text-sm font-semibold">{t.pasoOperacion}</legend>
        <p className="text-xs leading-relaxed text-texto-suave">
          Esto no está en la hoja de inventario: son decisiones suyas y hay que
          ponerlas a mano.
        </p>

        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            id="fechaEmbarque"
            etiqueta={t.fecha}
            ayuda={t.ayudaFecha}
            error={errores.fechaEmbarque}
          >
            <input
              id="fechaEmbarque"
              name="fechaEmbarque"
              type="date"
              required
              value={campos.fechaEmbarque}
              onChange={(e) => actualizar({ fechaEmbarque: e.target.value })}
              className={CLASES_INPUT}
            />
          </Campo>

          <Campo
            id="diferencialUsdTm"
            etiqueta={esPorcentual ? t.diferencialPct : t.diferencial}
            ayuda={esPorcentual ? t.ayudaDiferencialPct : t.ayudaDiferencial}
            error={errores.diferencialUsdTm}
          >
            <div className="grid grid-cols-[1fr_7.5rem] gap-2">
              <input
                id="diferencialUsdTm"
                name="diferencialUsdTm"
                inputMode="text"
                required
                placeholder={
                  esPorcentual ? t.placeholderDiferencialPct : t.placeholderDiferencial
                }
                value={campos.diferencialUsdTm}
                onChange={(e) => actualizar({ diferencialUsdTm: e.target.value })}
                className={CLASES_INPUT}
              />
              {/* La unidad va pegada al número, no en un paso aparte: es
                  parte de lo que el usuario escribe, y separarlas invita a
                  teclear 23,5 pensando en porcentaje y que se lea como
                  dólares. */}
              <select
                name="modoDiferencial"
                aria-label="Unidad del diferencial"
                value={campos.modoDiferencial}
                onChange={(e) =>
                  actualizar({
                    modoDiferencial: e.target.value as Campos["modoDiferencial"],
                    // El número anterior queda sin sentido en la otra
                    // unidad: −300 USD/TM leído como −300 % es absurdo.
                    diferencialUsdTm: "",
                  })
                }
                className={CLASES_INPUT}
              >
                <option value="absoluto">USD/TM</option>
                <option value="porcentual">% de NY</option>
              </select>
            </div>
          </Campo>
        </div>

        {esInventario ? (
          <Campo
            id="tipoContrato"
            etiqueta="¿Cómo está pactada la venta?"
            error={errores.tipoContrato}
          >
            <select
              id="tipoContrato"
              name="tipoContrato"
              value={campos.tipoContrato}
              onChange={(e) => actualizar({ tipoContrato: e.target.value })}
              className={CLASES_INPUT}
            >
              <option value="sin_contrato">Aún sin comprador</option>
              <option value="por_fijar_ny">Comprador con precio por fijar contra NY</option>
              <option value="precio_fijo_usd">Precio ya cerrado en USD</option>
            </select>
          </Campo>
        ) : (
          <input type="hidden" name="tipoContrato" value="precio_fijo_usd" />
        )}

        {pidePrecio ? (
          <Campo
            id="precioVentaUsdTm"
            etiqueta={t.precio}
            ayuda={t.ayudaPrecio}
            error={errores.precioVentaUsdTm}
          >
            <input
              id="precioVentaUsdTm"
              name="precioVentaUsdTm"
              inputMode="decimal"
              required={!esInventario}
              placeholder="6.211"
              value={campos.precioVentaUsdTm}
              onChange={(e) => actualizar({ precioVentaUsdTm: e.target.value })}
              className={CLASES_INPUT}
            />
          </Campo>
        ) : (
          <input type="hidden" name="precioVentaUsdTm" value="" />
        )}

        {series.length > 0 ? (
          <Campo
            id="origenCacao"
            etiqueta="Contrato de referencia"
            ayuda="La serie de precios contra la que se calcula. Un vencimiento concreto es más preciso que el continuo; verifique que siga vivo."
          >
            <select id="origenCacao" name="origenCacao" className={CLASES_INPUT}>
              <option value="">Fuente en vivo (continuo)</option>
              {series.map((serie) => (
                <option
                  key={`${serie.simbolo}|${serie.fuente}`}
                  value={`${serie.simbolo}|${serie.fuente}`}
                >
                  {serie.simbolo} · {NOMBRE_FUENTE[serie.fuente] ?? serie.fuente} ·{" "}
                  {serie.barras} barras hasta {serie.ultima}
                </option>
              ))}
            </select>
          </Campo>
        ) : null}
      </fieldset>

      {estado.mensaje ? (
        <p
          role="alert"
          className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo"
        >
          {estado.mensaje}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro disabled:opacity-60 sm:w-auto"
      >
        {enviando
          ? "Calculando…"
          : esInventario
            ? "Analizar cobertura"
            : "Analizar cobertura de compra"}
      </button>
    </form>
  );
}
