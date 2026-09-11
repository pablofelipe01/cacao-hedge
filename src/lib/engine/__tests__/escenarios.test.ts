import { describe, expect, it } from "vitest";

import {
  EJE_BASE,
  EJE_PRECIO,
  EJE_TRM,
  construirMatrizEscenarios,
  encontrarCasoBase,
  escenarioBase,
} from "../escenarios";

const MERCADO = { futuroUsdTm: 6000, trm: 3100 };

describe("construirMatrizEscenarios", () => {
  const matriz = construirMatrizEscenarios(MERCADO, 250);

  it("genera el producto cartesiano de los tres ejes", () => {
    expect(EJE_PRECIO).toHaveLength(7);
    expect(EJE_TRM).toHaveLength(3);
    expect(EJE_BASE).toHaveLength(3);
    expect(matriz).toHaveLength(7 * 3 * 3);
  });

  it("cubre el rango de precios de -30 % a +30 %", () => {
    const precios = matriz.map((e) => e.futuroUsdTm);
    expect(Math.min(...precios)).toBeCloseTo(4200, 9);
    expect(Math.max(...precios)).toBeCloseTo(7800, 9);
  });

  it("cubre el rango de TRM de -10 % a +10 %", () => {
    const trms = matriz.map((e) => e.trm);
    expect(Math.min(...trms)).toBeCloseTo(2790, 9);
    expect(Math.max(...trms)).toBeCloseTo(3410, 9);
  });

  it("desplaza la base ±100 USD/TM alrededor del diferencial del lote", () => {
    const bases = [...new Set(matriz.map((e) => e.diferencialUsdTm))].sort((a, b) => a - b);
    expect(bases).toEqual([150, 250, 350]);
  });

  it("mueve los tres ejes de forma independiente", () => {
    // Para un mismo precio de futuro deben existir las tres bases: eso es
    // lo que permite ver el riesgo de base con la cobertura puesta.
    const aPrecioBase = matriz.filter((e) => e.ejes.precio === 0);
    expect(new Set(aPrecioBase.map((e) => e.diferencialUsdTm)).size).toBe(3);
    expect(new Set(aPrecioBase.map((e) => e.trm)).size).toBe(3);
  });

  it("etiqueta cada escenario de forma legible", () => {
    const extremo = matriz.find(
      (e) => e.ejes.precio === -0.3 && e.ejes.trm === 0.1 && e.ejes.base === -100,
    );
    expect(extremo?.etiqueta).toBe("futuro -30 % · TRM +10 % · base -100");
  });

  it("contiene exactamente un caso sin cambios", () => {
    const sinCambios = matriz.filter(
      (e) => e.ejes.precio === 0 && e.ejes.trm === 0 && e.ejes.base === 0,
    );
    expect(sinCambios).toHaveLength(1);

    const base = encontrarCasoBase(matriz);
    expect(base.futuroUsdTm).toBe(6000);
    expect(base.trm).toBe(3100);
    expect(base.diferencialUsdTm).toBe(250);
  });
});

describe("escenarioBase", () => {
  it("reproduce el mercado sin desviaciones", () => {
    const base = escenarioBase(MERCADO, -120);
    expect(base.futuroUsdTm).toBe(6000);
    expect(base.trm).toBe(3100);
    expect(base.diferencialUsdTm).toBe(-120);
    expect(base.ejes).toEqual({ precio: 0, trm: 0, base: 0 });
  });
});

describe("encontrarCasoBase", () => {
  it("falla si la matriz no incluye el caso sin cambios", () => {
    const sinBase = construirMatrizEscenarios(MERCADO, 0).filter(
      (e) => e.ejes.precio !== 0,
    );
    expect(() => encontrarCasoBase(sinBase)).toThrow(/sin cambios/);
  });
});
