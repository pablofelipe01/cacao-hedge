/**
 * El recálculo del analista.
 *
 * Es la pieza que hace que el chat no invente: cuando el exportador
 * pregunta «¿y si solo consigo 30 toneladas?», el modelo no estima, llama
 * a esto y el motor responde de verdad.
 *
 * Lo que se prueba aquí es la propiedad que hace honesta la comparación:
 * parte del análisis en pantalla y SOLO pisa lo que se le indique.
 */
import { describe, expect, it } from "vitest";

import { ejecutarRecalculo, type ContextoAnalisis } from "../analista";
import { SUPUESTOS_POR_DEFECTO, type Lote, type Mercado } from "@/lib/engine/tipos";

const LOTE: Lote = {
  toneladas: 40,
  costoCopKg: 0,
  diasAEmbarque: 90,
  diferencialUsdTm: 0,
  diferencialPorcentual: -0.235,
  tipoOperacion: "venta_sin_comprar",
  tipoContrato: "precio_fijo_usd",
  precioVentaUsdTm: 6500,
};

const MERCADO: Mercado = {
  futuroUsdTm: 5961,
  trm: 3101,
  volAnualizada: 0.533,
  volTrmAnualizada: 0.124,
  fechaDatos: "2026-09-11",
};

const CONTEXTO: ContextoAnalisis = {
  lote: LOTE,
  mercado: MERCADO,
  supuestos: SUPUESTOS_POR_DEFECTO,
  fechaEmbarque: "2026-12-10",
  procedencia: { fuente: "barchart_csv", simbolo: "CCZ26", barras: 426 },
};

describe("recálculo del analista", () => {
  it("sin cambios reproduce el análisis de pantalla", () => {
    const r = ejecutarRecalculo(CONTEXTO, { descripcion: "igual" });
    expect(r.lote.toneladas).toBe(40);
    expect(r.mercado.futuroUsdTm).toBe(5961);
    expect(r.lote.precioVentaPactadoUsdTm).toBe(6500);
  });

  it("cambia solo lo que se le indica", () => {
    // «¿y si solo consigo 30 de las 40 toneladas?»
    const r = ejecutarRecalculo(CONTEXTO, { descripcion: "30 TM", toneladas: 30 });
    expect(r.lote.toneladas).toBe(30);
    // Todo lo demás se conserva: si no, la comparación sería tramposa.
    expect(r.mercado.futuroUsdTm).toBe(5961);
    expect(r.mercado.trm).toBe(3101);
    expect(r.lote.precioVentaPactadoUsdTm).toBe(6500);
    expect(r.lote.diferencialPorcentaje).toBeCloseTo(-23.5, 2);
  });

  it("mueve el mercado sin tocar el lote", () => {
    // «¿y si el cacao se va a 7.000 antes de que compre?»
    const r = ejecutarRecalculo(CONTEXTO, { descripcion: "NY a 7.000", futuroUsdTm: 7000 });
    expect(r.mercado.futuroUsdTm).toBe(7000);
    expect(r.lote.toneladas).toBe(40);
    // Con descuento porcentual, el costo sube menos que la bolsa.
    expect(r.precioFisicoEsperadoUsdTm).toBeCloseTo(7000 * 0.765, 0);
  });

  it("acepta el diferencial en porcentaje y desactiva el fijo", () => {
    const r = ejecutarRecalculo(CONTEXTO, {
      descripcion: "el productor sube el precio",
      diferencialPorcentaje: -18,
    });
    expect(r.lote.diferencialPorcentaje).toBeCloseTo(-18, 2);
    expect(r.lote.diferencialUsdTm).toBeUndefined();
  });

  it("acepta el diferencial fijo y desactiva el porcentual", () => {
    const r = ejecutarRecalculo(CONTEXTO, {
      descripcion: "pacta un número en dólares",
      diferencialUsdTm: -1400,
    });
    expect(r.lote.diferencialUsdTm).toBe(-1400);
    expect(r.lote.diferencialPorcentaje).toBeUndefined();
  });

  it("ignora valores que no son números en vez de romperse", () => {
    // El modelo podría mandar una cadena o un nulo; eso no debe tumbar
    // la conversación, solo no tener efecto.
    const r = ejecutarRecalculo(CONTEXTO, {
      descripcion: "basura",
      toneladas: "treinta" as unknown as number,
      futuroUsdTm: null as unknown as number,
    });
    expect(r.lote.toneladas).toBe(40);
    expect(r.mercado.futuroUsdTm).toBe(5961);
  });

  it("propaga el error de un escenario imposible", () => {
    // Cero toneladas no es un análisis: es una pregunta mal planteada, y
    // el modelo debe poder explicar por qué en vez de recibir ceros.
    expect(() => ejecutarRecalculo(CONTEXTO, { descripcion: "nada", toneladas: 0 })).toThrow();
  });

  it("el escenario recalculado trae las estrategias completas", () => {
    const r = ejecutarRecalculo(CONTEXTO, { descripcion: "30 TM", toneladas: 30 });
    expect(r.estrategias.length).toBeGreaterThan(3);
    expect(r.estrategias.every((e) => typeof e.utilidadPercentil5Cop === "number")).toBe(true);
    expect(r.recomendacion.nombre.length).toBeGreaterThan(0);
  });
});
