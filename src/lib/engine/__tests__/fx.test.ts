import { describe, expect, it } from "vitest";

import {
  copAUsd,
  costoAdquisicionCop,
  costoCopTm,
  costoUsdTm,
  precioEquilibrioUsdTm,
  precioFisicoUsdTm,
  usdACop,
} from "../fx";
import type { Lote } from "../tipos";

describe("conversión COP/USD", () => {
  it("convierte en ambos sentidos de forma consistente", () => {
    expect(usdACop(100, 3101)).toBe(310_100);
    expect(copAUsd(310_100, 3101)).toBe(100);
    expect(copAUsd(usdACop(1234.56, 3101), 3101)).toBeCloseTo(1234.56, 9);
  });

  it("rechaza una TRM no positiva", () => {
    expect(() => usdACop(100, 0)).toThrow(/TRM/);
    expect(() => copAUsd(100, -1)).toThrow(/TRM/);
  });
});

describe("costos de adquisición", () => {
  it("pasa de COP/kg a COP/TM multiplicando por 1000", () => {
    expect(costoCopTm(14_500)).toBe(14_500_000);
  });

  it("calcula el costo total del lote", () => {
    expect(costoAdquisicionCop(137, 14_500)).toBe(137 * 14_500_000);
  });

  it("expresa el costo por tonelada en USD a la TRM dada", () => {
    // 14.500 COP/kg = 14.500.000 COP/TM; a 3.101 COP/USD ≈ 4.676 USD/TM
    expect(costoUsdTm(14_500, 3101)).toBeCloseTo(4675.91, 2);
  });

  it("el punto de equilibrio es el costo por tonelada en USD", () => {
    expect(precioEquilibrioUsdTm(14_500, 3101)).toBe(costoUsdTm(14_500, 3101));
  });
});

describe("precioFisicoUsdTm", () => {
  const porFijar: Pick<Lote, "tipoContrato" | "precioVentaUsdTm"> = {
    tipoContrato: "por_fijar_ny",
    precioVentaUsdTm: null,
  };

  it("suma el diferencial al futuro cuando el precio está por fijar", () => {
    expect(precioFisicoUsdTm(porFijar, 6000, 250)).toBe(6250);
    expect(precioFisicoUsdTm(porFijar, 6000, -150)).toBe(5850);
  });

  it("ignora el futuro cuando el contrato es a precio fijo", () => {
    const fijo: Pick<Lote, "tipoContrato" | "precioVentaUsdTm"> = {
      tipoContrato: "precio_fijo_usd",
      precioVentaUsdTm: 6400,
    };
    expect(precioFisicoUsdTm(fijo, 6000, 250)).toBe(6400);
    expect(precioFisicoUsdTm(fijo, 3000, -800)).toBe(6400);
  });

  it("exige el precio pactado si el contrato es a precio fijo", () => {
    const incompleto: Pick<Lote, "tipoContrato" | "precioVentaUsdTm"> = {
      tipoContrato: "precio_fijo_usd",
      precioVentaUsdTm: null,
    };
    expect(() => precioFisicoUsdTm(incompleto, 6000, 0)).toThrow(/precio fijo/);
  });
});
