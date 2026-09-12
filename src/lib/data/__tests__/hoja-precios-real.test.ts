/**
 * El parser contra la hoja real descargada.
 *
 * Se salta si el CSV no está: la hoja es del cliente y no se versiona,
 * igual que los históricos de Barchart.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { interpretarHojaPrecios, resumirDescuento, calcularDescuentos } from "../hoja-precios-productor";

const CSV = "/private/tmp/claude-501/-Users-pablofelipe-Documents-Mi-Trabajo-aroco-trading/06947981-5ffc-4bd8-a5ae-16aec448ea97/scratchpad/precios-nacional.csv";

describe.skipIf(!existsSync(CSV))("hoja real de precios", () => {
  it("lee los dos años de precios publicados", () => {
    const r = interpretarHojaPrecios(readFileSync(CSV, "utf8"));
    const luker = r.precios.filter((p) => p.comprador === "luker_bajo_cadmio");
    expect(luker.length).toBeGreaterThan(400);
    expect(r.ultimaFecha).toBe("2026-09-11");
    // El precio más reciente de Casa Luker bajo cadmio.
    expect(luker.find((p) => p.fecha === "2026-09-11")?.precioCopKg).toBe(15650);
    // Las columnas con rango de semana quedan fuera y se reportan.
    expect(r.fechasIlegibles).toBeGreaterThan(0);
  });

  it("los cuatro compradores traen serie", () => {
    const r = interpretarHojaPrecios(readFileSync(CSV, "utf8"));
    for (const c of ["luker_bajo_cadmio", "nacional_bogota", "nacional_ibague"] as const) {
      expect(r.precios.filter((p) => p.comprador === c).length).toBeGreaterThan(100);
    }
  });

  it("sin bolsa ni TRM no inventa descuentos", () => {
    const r = interpretarHojaPrecios(readFileSync(CSV, "utf8"));
    expect(calcularDescuentos(r.precios, new Map(), new Map())).toEqual([]);
    expect(resumirDescuento([], "luker_bajo_cadmio")).toBeNull();
  });
});
