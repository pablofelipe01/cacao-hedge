import { describe, expect, it } from "vitest";

import {
  crearPrng,
  desviacionEstandar,
  factorZ,
  media,
  normalAcumulada,
  normalInversa,
  parNormalEstandar,
  percentil,
} from "../numerico";

describe("normalAcumulada", () => {
  it("vale 0,5 en el centro y es simétrica", () => {
    // Tolerancia 1e-7: es el error máximo documentado de la aproximación A&S 26.2.17.
    expect(normalAcumulada(0)).toBeCloseTo(0.5, 7);
    expect(normalAcumulada(1) + normalAcumulada(-1)).toBeCloseTo(1, 7);
  });

  it("reproduce valores de tabla", () => {
    expect(normalAcumulada(1.0)).toBeCloseTo(0.8413447, 6);
    expect(normalAcumulada(1.645)).toBeCloseTo(0.95, 4);
    expect(normalAcumulada(1.96)).toBeCloseTo(0.975, 5);
    expect(normalAcumulada(-2.0)).toBeCloseTo(0.0227501, 6);
  });

  it("satura en las colas extremas", () => {
    expect(normalAcumulada(10)).toBeCloseTo(1, 9);
    expect(normalAcumulada(-10)).toBeCloseTo(0, 9);
  });
});

describe("normalInversa", () => {
  it("invierte la acumulada", () => {
    for (const p of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
      expect(normalAcumulada(normalInversa(p))).toBeCloseTo(p, 6);
    }
  });

  it("el factor z del 95 % es 1,645", () => {
    expect(factorZ(0.95)).toBeCloseTo(1.6449, 4);
    expect(factorZ(0.99)).toBeCloseTo(2.3263, 4);
  });

  it("rechaza probabilidades fuera del intervalo abierto (0,1)", () => {
    expect(() => normalInversa(0)).toThrow();
    expect(() => normalInversa(1)).toThrow();
  });
});

describe("PRNG sembrado", () => {
  it("la misma semilla produce la misma secuencia", () => {
    const a = crearPrng(42);
    const b = crearPrng(42);
    const secuenciaA = Array.from({ length: 20 }, () => a());
    const secuenciaB = Array.from({ length: 20 }, () => b());
    expect(secuenciaA).toEqual(secuenciaB);
  });

  it("semillas distintas producen secuencias distintas", () => {
    const a = crearPrng(1);
    const b = crearPrng(2);
    expect(a()).not.toBe(b());
  });

  it("genera valores dentro de [0,1)", () => {
    const prng = crearPrng(7);
    for (let i = 0; i < 1000; i++) {
      const v = prng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("Box-Muller produce normales con media ~0 y desviación ~1", () => {
    const prng = crearPrng(123);
    const muestra: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const [z1, z2] = parNormalEstandar(prng);
      muestra.push(z1, z2);
    }
    expect(media(muestra)).toBeCloseTo(0, 1);
    expect(desviacionEstandar(muestra)).toBeCloseTo(1, 1);
  });
});

describe("estadística descriptiva", () => {
  it("calcula media y desviación muestral", () => {
    expect(media([2, 4, 6])).toBe(4);
    // Desviación muestral de [2,4,4,4,5,5,7,9] = 2,138…
    expect(desviacionEstandar([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.1381, 4);
  });

  it("interpola percentiles sobre la muestra ordenada", () => {
    const datos = [1, 2, 3, 4, 5];
    expect(percentil(datos, 0)).toBe(1);
    expect(percentil(datos, 0.5)).toBe(3);
    expect(percentil(datos, 1)).toBe(5);
    expect(percentil(datos, 0.25)).toBe(2);
    expect(percentil([10, 20], 0.5)).toBe(15);
  });
});
