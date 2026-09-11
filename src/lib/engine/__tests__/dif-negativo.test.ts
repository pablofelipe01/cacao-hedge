import { describe, expect, it } from "vitest";
import { interpretarNumero } from "@/lib/acciones/esquemas";
import { esquemaAnalisis } from "@/lib/acciones/esquemas";
import { precioFisicoUsdTm, precioMaximoCompraUsdTm } from "@/lib/engine/fx";

describe("diferencial negativo", () => {
  it("el parser acepta las formas que escribiría un colombiano", () => {
    expect(interpretarNumero("-300")).toBe(-300);
    expect(interpretarNumero("-1.500")).toBe(-1500);   // miles
    expect(interpretarNumero("-300,5")).toBe(-300.5);  // decimal con coma
    expect(interpretarNumero("- 300")).toBe(-300);     // con espacio
  });

  it("el esquema del formulario no lo rechaza", () => {
    const r = esquemaAnalisis.safeParse({
      situacion: "ya_vendi", toneladas: "40", fechaEmbarque: "2026-12-10",
      diferencialUsdTm: "-300", tipoContrato: "precio_fijo_usd", precioVentaUsdTm: "6500",
    });
    expect(r.success).toBe(true);
    expect(r.data?.diferencialUsdTm).toBe(-300);
  });

  it("comprar por debajo de la bolsa abarata el físico y sube el techo", () => {
    const lote = { tipoContrato: "precio_fijo_usd" as const, precioVentaUsdTm: 6500, tipoOperacion: "venta_sin_comprar" as const };
    expect(precioFisicoUsdTm(lote, 5961, -300)).toBe(5661);          // paga menos que NY
    expect(precioMaximoCompraUsdTm(6500, -300)).toBe(6800);          // el futuro puede subir más
    expect(precioMaximoCompraUsdTm(6500, 250)).toBe(6250);           // con prima, menos margen
  });
});
