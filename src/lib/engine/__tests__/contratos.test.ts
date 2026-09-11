import { describe, expect, it } from "vitest";

import { dimensionarCobertura, nocionalUsd } from "../contratos";

describe("dimensionarCobertura", () => {
  it("con inventario múltiplo de 10 TM la cobertura calza exacta", () => {
    const d = dimensionarCobertura(100, 1);

    expect(d.contratosExactos).toBe(10);
    expect(d.subcobertura.contratos).toBe(10);
    expect(d.sobrecobertura.contratos).toBe(10);
    expect(d.recomendada.tipo).toBe("exacta");
    expect(d.recomendada.toneladasResiduales).toBe(0);
  });

  it("redondea hacia abajo y hacia arriba dejando el residual correcto", () => {
    const d = dimensionarCobertura(137, 1);

    expect(d.contratosExactos).toBeCloseTo(13.7, 10);

    expect(d.subcobertura.contratos).toBe(13);
    expect(d.subcobertura.toneladasCubiertas).toBe(130);
    expect(d.subcobertura.toneladasResiduales).toBeCloseTo(7, 10);
    expect(d.subcobertura.tipo).toBe("subcobertura");

    expect(d.sobrecobertura.contratos).toBe(14);
    expect(d.sobrecobertura.toneladasCubiertas).toBe(140);
    expect(d.sobrecobertura.toneladasResiduales).toBeCloseTo(-3, 10);
    expect(d.sobrecobertura.tipo).toBe("sobrecobertura");
  });

  it("recomienda la alternativa con menor residual absoluto", () => {
    // 137 TM: sobrecubrir deja 3 TM de residual, subcubrir deja 7.
    expect(dimensionarCobertura(137, 1).recomendada.contratos).toBe(14);
    // 132 TM: subcubrir deja 2 TM, sobrecubrir dejaría 8.
    expect(dimensionarCobertura(132, 1).recomendada.contratos).toBe(13);
  });

  it("ante un empate prefiere la subcobertura antes que vender lo que no se tiene", () => {
    const d = dimensionarCobertura(135, 1);

    expect(Math.abs(d.subcobertura.toneladasResiduales)).toBe(5);
    expect(Math.abs(d.sobrecobertura.toneladasResiduales)).toBe(5);
    expect(d.recomendada.tipo).toBe("subcobertura");
  });

  it("aplica el ratio de cobertura sobre el inventario", () => {
    const d = dimensionarCobertura(200, 0.5);

    expect(d.toneladasObjetivo).toBe(100);
    expect(d.recomendada.contratos).toBe(10);
    expect(d.recomendada.ratioEfectivo).toBe(1);
  });

  it("advierte que la sobrecobertura deja posición neta corta", () => {
    const d = dimensionarCobertura(137, 1);
    expect(d.sobrecobertura.exposicionResidual).toMatch(/neta corta/i);
    expect(d.subcobertura.exposicionResidual).toMatch(/expuestas a la baja/i);
  });

  it("rechaza entradas imposibles", () => {
    expect(() => dimensionarCobertura(0, 1)).toThrow(/mayores que cero/);
    expect(() => dimensionarCobertura(100, 1.5)).toThrow(/entre 0 y 1/);
  });
});

describe("nocionalUsd", () => {
  it("multiplica contratos por tamaño y precio", () => {
    expect(nocionalUsd(10, 6000)).toBe(600_000);
  });
});
