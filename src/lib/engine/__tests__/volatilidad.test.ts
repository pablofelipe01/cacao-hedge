import { describe, expect, it } from "vitest";

import {
  MINIMO_OBSERVACIONES,
  diasAAnios,
  retornosLogaritmicos,
  volatilidadHistorica,
  volatilidadHorizonte,
} from "../volatilidad";

/** Serie con retorno logarítmico diario constante en magnitud. */
function serieAlternante(n: number, inicio = 100, paso = 0.01): number[] {
  const cierres = [inicio];
  for (let i = 1; i < n; i++) {
    cierres.push(cierres[i - 1] * Math.exp(i % 2 === 0 ? paso : -paso));
  }
  return cierres;
}

describe("retornosLogaritmicos", () => {
  it("devuelve n-1 retornos", () => {
    expect(retornosLogaritmicos([100, 110, 121])).toHaveLength(2);
  });

  it("calcula log(actual/anterior)", () => {
    const [r] = retornosLogaritmicos([100, 110]);
    expect(r).toBeCloseTo(Math.log(1.1), 12);
  });

  it("descarta precios no positivos en vez de producir NaN", () => {
    const retornos = retornosLogaritmicos([100, 0, 110, -5, 120]);
    expect(retornos.every(Number.isFinite)).toBe(true);
  });
});

describe("volatilidadHistorica", () => {
  it("cae al valor de respaldo si la serie es corta", () => {
    const r = volatilidadHistorica([100, 101, 102], 0.35);
    expect(r.usoRespaldo).toBe(true);
    expect(r.anualizada).toBe(0.35);
  });

  it("exige al menos el mínimo de observaciones", () => {
    const justo = volatilidadHistorica(serieAlternante(MINIMO_OBSERVACIONES + 1), 0.35);
    expect(justo.usoRespaldo).toBe(false);
    expect(justo.observaciones).toBe(MINIMO_OBSERVACIONES);
  });

  it("cae al respaldo si la serie es constante", () => {
    const r = volatilidadHistorica(new Array(60).fill(6000), 0.4);
    expect(r.usoRespaldo).toBe(true);
    expect(r.anualizada).toBe(0.4);
  });

  it("anualiza multiplicando por la raíz de los días hábiles", () => {
    const r = volatilidadHistorica(serieAlternante(200), 0.35);
    expect(r.usoRespaldo).toBe(false);
    expect(r.anualizada).toBeCloseTo(r.diaria * Math.sqrt(252), 10);
    // Retornos de ±1 % diario dan ~15,9 % anualizado.
    expect(r.anualizada).toBeCloseTo(0.01 * Math.sqrt(252), 3);
  });
});

describe("escalado temporal", () => {
  it("aplica la regla de la raíz del tiempo", () => {
    expect(volatilidadHorizonte(0.4, 1)).toBeCloseTo(0.4, 12);
    expect(volatilidadHorizonte(0.4, 0.25)).toBeCloseTo(0.2, 12);
    expect(volatilidadHorizonte(0.4, 0)).toBe(0);
  });

  it("convierte días calendario a años base 365", () => {
    expect(diasAAnios(365)).toBe(1);
    expect(diasAAnios(90)).toBeCloseTo(0.246575, 6);
  });

  it("rechaza horizontes negativos", () => {
    expect(() => volatilidadHorizonte(0.4, -1)).toThrow(/negativo/);
  });
});
