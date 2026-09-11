import { describe, expect, it } from "vitest";

import {
  payoffOpcion,
  redondearStrike,
  strikeCollarCostoCero,
  valorarOpcion,
  type ParametrosOpcion,
} from "../opciones";

const ATM: ParametrosOpcion = {
  futuro: 100,
  strike: 100,
  anios: 1,
  volatilidad: 0.2,
  tasa: 0,
};

describe("payoffOpcion", () => {
  it("el put paga la diferencia solo por debajo del strike", () => {
    expect(payoffOpcion("put", 5500, 6000)).toBe(500);
    expect(payoffOpcion("put", 6500, 6000)).toBe(0);
    expect(payoffOpcion("put", 6000, 6000)).toBe(0);
  });

  it("el call paga la diferencia solo por encima del strike", () => {
    expect(payoffOpcion("call", 6500, 6000)).toBe(500);
    expect(payoffOpcion("call", 5500, 6000)).toBe(0);
  });
});

describe("Black-76", () => {
  it("cumple la paridad put-call: C − P = (F − K)·e^(−rT)", () => {
    const casos: ParametrosOpcion[] = [
      { futuro: 6000, strike: 5500, anios: 0.5, volatilidad: 0.35, tasa: 0.0425 },
      { futuro: 6000, strike: 6000, anios: 0.25, volatilidad: 0.4, tasa: 0.05 },
      { futuro: 6000, strike: 6800, anios: 1, volatilidad: 0.3, tasa: 0.03 },
    ];

    for (const p of casos) {
      const call = valorarOpcion("call", p).primaUsdTm;
      const put = valorarOpcion("put", p).primaUsdTm;
      const esperado = (p.futuro - p.strike) * Math.exp(-p.tasa * p.anios);
      expect(call - put).toBeCloseTo(esperado, 8);
    }
  });

  it("valora la opción ATM cerca de la aproximación 0,4·σ·√T·F", () => {
    const call = valorarOpcion("call", ATM).primaUsdTm;
    expect(call).toBeCloseTo(7.9656, 3);
    expect(call).toBeCloseTo(0.3989 * 0.2 * 100, 1);
  });

  it("con tasa cero el put y el call ATM valen lo mismo", () => {
    expect(valorarOpcion("put", ATM).primaUsdTm).toBeCloseTo(
      valorarOpcion("call", ATM).primaUsdTm,
      9,
    );
  });

  it("la prima del put crece con el strike y la del call decrece", () => {
    const conStrike = (strike: number) => ({ ...ATM, strike });
    const put90 = valorarOpcion("put", conStrike(90)).primaUsdTm;
    const put110 = valorarOpcion("put", conStrike(110)).primaUsdTm;
    const call90 = valorarOpcion("call", conStrike(90)).primaUsdTm;
    const call110 = valorarOpcion("call", conStrike(110)).primaUsdTm;

    expect(put110).toBeGreaterThan(put90);
    expect(call90).toBeGreaterThan(call110);
  });

  it("la prima crece con la volatilidad y con el tiempo", () => {
    const bajaVol = valorarOpcion("put", { ...ATM, volatilidad: 0.2 }).primaUsdTm;
    const altaVol = valorarOpcion("put", { ...ATM, volatilidad: 0.5 }).primaUsdTm;
    const corto = valorarOpcion("put", { ...ATM, anios: 0.25 }).primaUsdTm;

    expect(altaVol).toBeGreaterThan(bajaVol);
    expect(bajaVol).toBeGreaterThan(corto);
  });

  it("sin tiempo ni volatilidad la prima colapsa al valor intrínseco", () => {
    const itm = { ...ATM, strike: 120, anios: 0 };
    expect(valorarOpcion("put", itm).primaUsdTm).toBeCloseTo(20, 9);
    expect(valorarOpcion("call", itm).primaUsdTm).toBe(0);

    const sinVol = { ...ATM, strike: 120, volatilidad: 0, tasa: 0 };
    expect(valorarOpcion("put", sinVol).primaUsdTm).toBeCloseTo(20, 9);
  });

  it("la prima por contrato es diez veces la prima por tonelada", () => {
    const v = valorarOpcion("put", ATM);
    expect(v.primaUsdContrato).toBeCloseTo(v.primaUsdTm * 10, 9);
  });

  it("las griegas tienen el signo y el rango correctos", () => {
    const put = valorarOpcion("put", ATM);
    const call = valorarOpcion("call", ATM);

    expect(put.delta).toBeLessThan(0);
    expect(put.delta).toBeGreaterThan(-1);
    expect(call.delta).toBeGreaterThan(0);
    expect(call.delta).toBeLessThan(1);
    // Paridad de deltas bajo Black-76: Δc − Δp = e^(−rT), aquí r = 0.
    expect(call.delta - put.delta).toBeCloseTo(1, 9);
    expect(put.gamma).toBeGreaterThan(0);
    expect(put.vega).toBeGreaterThan(0);
  });

  it("rechaza futuro o strike no positivos", () => {
    expect(() => valorarOpcion("put", { ...ATM, futuro: 0 })).toThrow();
    expect(() => valorarOpcion("put", { ...ATM, strike: -1 })).toThrow();
  });
});

describe("redondearStrike", () => {
  it("lleva al múltiplo de 25 más cercano", () => {
    expect(redondearStrike(5972)).toBe(5975);
    expect(redondearStrike(5960)).toBe(5950);
    expect(redondearStrike(6000)).toBe(6000);
  });
});

describe("strikeCollarCostoCero", () => {
  const put: ParametrosOpcion = {
    futuro: 6000,
    strike: 5700,
    anios: 0.5,
    volatilidad: 0.35,
    tasa: 0.0425,
  };

  it("sitúa el techo por encima del futuro y deja prima neta casi nula", () => {
    const { strikeCall, primaNetaUsdTm } = strikeCollarCostoCero(put, {
      tasaLibreRiesgo: 0.0425,
    });

    expect(strikeCall).toBeGreaterThan(put.futuro);
    // Costo cero salvo la granularidad del paso de strikes: la prima
    // neta residual debe ser marginal frente a la del put financiado.
    const primaPut = valorarOpcion("put", put).primaUsdTm;
    expect(Math.abs(primaNetaUsdTm)).toBeLessThan(primaPut * 0.05);
  });

  it("un piso más alto obliga a bajar el techo para seguir financiándolo", () => {
    const pisoBajo = strikeCollarCostoCero({ ...put, strike: 5400 }, { tasaLibreRiesgo: 0.0425 });
    const pisoAlto = strikeCollarCostoCero({ ...put, strike: 5900 }, { tasaLibreRiesgo: 0.0425 });

    expect(pisoAlto.strikeCall).toBeLessThan(pisoBajo.strikeCall);
  });
});
