/**
 * El diferencial negativo, que es el caso normal al comprar.
 *
 * El exportador compra el físico en Colombia POR DEBAJO del futuro de
 * Nueva York —la bolsa cotiza cacao puesto en almacén autorizado, no en
 * finca— y lo vende afuera con prima de fino de aroma. Es decir: en el
 * caso A el diferencial suele ser negativo y en el B positivo.
 *
 * Estas pruebas existen porque el formulario nació asumiendo el signo
 * positivo: el ejemplo decía «250», el teclado móvil no ofrecía la tecla
 * de menos y el menos tipográfico de iOS se rechazaba en silencio. El
 * cálculo siempre estuvo bien; el camino hasta él, no.
 */
import { describe, expect, it } from "vitest";

import { esquemaAnalisis, interpretarNumero } from "@/lib/acciones/esquemas";
import { precioFisicoUsdTm, precioMaximoCompraUsdTm } from "../fx";

describe("diferencial negativo", () => {
  it("acepta las formas en que se escribe un negativo", () => {
    expect(interpretarNumero("-300")).toBe(-300);
    expect(interpretarNumero("-1.500")).toBe(-1500); // miles a la colombiana
    expect(interpretarNumero("-300,5")).toBe(-300.5); // decimal con coma
    expect(interpretarNumero("- 300")).toBe(-300);
    // El menos tipográfico de iOS/macOS: idéntico a la vista, otro carácter.
    expect(interpretarNumero("−300")).toBe(-300);
  });

  it("el esquema del formulario no lo rechaza", () => {
    const r = esquemaAnalisis.safeParse({
      situacion: "ya_vendi",
      toneladas: "40",
      fechaEmbarque: "2026-12-10",
      diferencialUsdTm: "-300",
      tipoContrato: "precio_fijo_usd",
      precioVentaUsdTm: "6500",
    });
    expect(r.success).toBe(true);
    expect(r.data?.diferencialUsdTm).toBe(-300);
  });

  it("comprar por debajo de la bolsa abarata el físico y sube el techo", () => {
    const lote = {
      tipoContrato: "precio_fijo_usd" as const,
      precioVentaUsdTm: 6500,
      tipoOperacion: "venta_sin_comprar" as const,
    };

    expect(precioFisicoUsdTm(lote, 5961, -300)).toBe(5661);
    // Con descuento, el futuro puede subir más antes de comerse el margen.
    expect(precioMaximoCompraUsdTm(6500, -300)).toBe(6800);
    expect(precioMaximoCompraUsdTm(6500, 250)).toBe(6250);
  });
});
