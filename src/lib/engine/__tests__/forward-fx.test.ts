/**
 * La cobertura cambiaria.
 *
 * El exportador cobra en dólares y vive en pesos. Una vez cubierto el
 * precio del cacao, medido sobre el caso real, cuatro quintas partes del
 * riesgo que queda son la TRM: el motor lo medía y lo dibujaba, pero no
 * ofrecía nada para hacerle algo.
 */
import { describe, expect, it } from "vitest";

import {
  construirCoberturasFx,
  puntosForward,
  resultadoForwardCop,
  tasaForwardCopUsd,
} from "../forward-fx";
import { evaluarEnEscenario } from "../estrategias";
import { analizarCobertura } from "../index";
import { SUPUESTOS_POR_DEFECTO, type Escenario, type Estrategia, type Lote, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 5961,
  trm: 3101,
  volAnualizada: 0.533,
  volTrmAnualizada: 0.124,
  fechaDatos: "2026-09-11",
};

describe("tasa forward por paridad de tasas", () => {
  it("queda POR ENCIMA de la TRM cuando la tasa en pesos es mayor", () => {
    // Es el hecho que más sorprende a un exportador: vender dólares a
    // plazo le paga, no le cuesta.
    const f = tasaForwardCopUsd(3101, 0.095, 0.042, 0.25);
    expect(f).toBeGreaterThan(3101);
    expect(f).toBeCloseTo(3140, 0);
    expect(puntosForward(3101, 0.095, 0.042, 0.25)).toBeCloseTo(39, 0);
  });

  it("se invierte si la tasa en dólares es la mayor", () => {
    expect(tasaForwardCopUsd(3101, 0.02, 0.05, 1)).toBeLessThan(3101);
  });

  it("a plazo cero es la TRM de contado", () => {
    expect(tasaForwardCopUsd(3101, 0.095, 0.042, 0)).toBe(3101);
  });

  it("rechaza entradas imposibles en vez de devolver un número raro", () => {
    expect(() => tasaForwardCopUsd(0, 0.095, 0.042, 1)).toThrow(/TRM/);
    expect(() => tasaForwardCopUsd(3101, 0.095, 0.042, -1)).toThrow(/plazo/);
    expect(() => tasaForwardCopUsd(3101, -2, 0.042, 1)).toThrow(/tasas/);
  });
});

describe("resultado del forward de venta", () => {
  it("gana cuando el peso se aprecia, que es cuando el físico pierde", () => {
    // Pactó 3.140 y la TRM terminó en 2.900: recibe 240 pesos de más por dólar.
    expect(resultadoForwardCop(100000, 3140, 2900)).toBeCloseTo(24_000_000, 0);
  });

  it("cuesta cuando el peso se devalúa, que es cuando el físico gana", () => {
    expect(resultadoForwardCop(100000, 3140, 3400)).toBeCloseTo(-26_000_000, 0);
  });

  it("sin nocional no aporta nada", () => {
    expect(resultadoForwardCop(0, 3140, 2900)).toBe(0);
  });
});

describe("la capa cambiaria dentro del escenario", () => {
  const lote: Lote = {
    toneladas: 15.275,
    costoCopKg: 16468,
    diasAEmbarque: 90,
    diferencialUsdTm: 250,
    tipoContrato: "sin_contrato",
  };

  const estrategia = (notionalUsd: number): Estrategia => ({
    id: "prueba",
    nombre: "prueba",
    tipo: "sin_cobertura",
    sentido: "corta",
    contratos: 0,
    toneladasCubiertas: 0,
    toneladasResiduales: lote.toneladas,
    ratioCobertura: 0,
    costoInicialUsd: 0,
    descripcion: "",
    ...(notionalUsd > 0
      ? { coberturaFx: { notionalUsd, tasaForward: 3140 } }
      : {}),
  });

  const enTrm = (trm: number): Escenario => ({
    futuroUsdTm: MERCADO.futuroUsdTm,
    trm,
    diferencialUsdTm: 250,
    etiqueta: "",
    ejes: { precio: 0, trm: 0, base: 0 },
  });

  it("aplana la utilidad frente a la TRM", () => {
    const sinFx = estrategia(0);
    const conFx = estrategia(94873); // el ingreso completo en dólares

    const rango = (e: Estrategia) =>
      Math.abs(
        evaluarEnEscenario(e, lote, MERCADO, enTrm(3400), SUPUESTOS_POR_DEFECTO).utilidadCop -
          evaluarEnEscenario(e, lote, MERCADO, enTrm(2800), SUPUESTOS_POR_DEFECTO).utilidadCop,
      );

    // Cubierto al 100 % del flujo, la TRM deja de mover la utilidad.
    expect(rango(conFx)).toBeLessThan(rango(sinFx) / 20);
  });

  it("no toca el resultado en dólares, solo la conversión", () => {
    const base = evaluarEnEscenario(estrategia(0), lote, MERCADO, enTrm(3101), SUPUESTOS_POR_DEFECTO);
    const fx = evaluarEnEscenario(estrategia(94873), lote, MERCADO, enTrm(3101), SUPUESTOS_POR_DEFECTO);
    expect(fx.ingresoNetoUsd).toBeCloseTo(base.ingresoNetoUsd, 6);
  });
});

describe("análisis completo con dimensión cambiaria", () => {
  const lote: Lote = {
    toneladas: 15.275,
    costoCopKg: 16468,
    diasAEmbarque: 90,
    diferencialUsdTm: 250,
    tipoContrato: "sin_contrato",
  };

  it("devuelve los cuatro grados de cobertura del dólar", () => {
    const r = analizarCobertura(lote, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(r.cambiario.map((c) => c.ratio)).toEqual([0, 0.5, 0.75, 1]);
    // El nocional es el flujo físico neto, no el valor del lote.
    expect(r.cambiario[3].notionalUsd).toBeCloseTo(15.275 * 6211, 0);
    expect(r.cambiario[0].notionalUsd).toBe(0);
  });

  it("los puntos forward juegan a favor del exportador", () => {
    const r = analizarCobertura(lote, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(r.cambiario[3].puntosForward).toBeGreaterThan(0);
    expect(r.cambiario[3].tasaForward).toBeGreaterThan(MERCADO.trm);
  });

  it("cubrir el dólar estrecha la cola de la utilidad", () => {
    const r = analizarCobertura(lote, MERCADO, SUPUESTOS_POR_DEFECTO);
    const sin = r.cambiario[0].monteCarlo;
    const todo = r.cambiario[3].monteCarlo;
    expect(todo.desviacionCop).toBeLessThan(sin.desviacionCop);
    expect(todo.percentiles.p5).toBeGreaterThan(sin.percentiles.p5);
  });
});
