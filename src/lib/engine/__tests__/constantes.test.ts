import { describe, expect, it } from "vitest";

import {
  CC_MESES_VENCIMIENTO,
  CC_TICK_USD_TM,
  CC_TONELADAS_POR_CONTRATO,
  CC_VALOR_TICK_USD,
} from "../constantes";

describe("especificación del contrato CC (ICE)", () => {
  it("cubre 10 toneladas métricas por contrato", () => {
    expect(CC_TONELADAS_POR_CONTRATO).toBe(10);
  });

  it("el tick de 1 USD/TM vale 10 USD por contrato", () => {
    expect(CC_TICK_USD_TM).toBe(1);
    expect(CC_VALOR_TICK_USD).toBe(10);
  });

  it("lista los cinco vencimientos H, K, N, U, Z", () => {
    expect(CC_MESES_VENCIMIENTO.map((m) => m.codigo)).toEqual([
      "H",
      "K",
      "N",
      "U",
      "Z",
    ]);
    expect(CC_MESES_VENCIMIENTO.map((m) => m.mes)).toEqual([3, 5, 7, 9, 12]);
  });
});
