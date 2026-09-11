import { describe, expect, it } from "vitest";

import {
  erroresPorCampo,
  esquemaAnalisis,
  esquemaConfiguracion,
  esquemaLote,
  interpretarNumero,
} from "../esquemas";

const CONFIG_VALIDA = {
  margenInicialUsd: "8000",
  margenMantenimientoUsd: "7200",
  comisionUsdContrato: "15",
  tasaLibreRiesgoPorcentaje: "4,25",
  volFallbackPorcentaje: "35",
  diasHabilesAnio: "252",
  nivelConfianzaVarPorcentaje: "95",
  trayectoriasMc: "10000",
};

const LOTE_VALIDO = {
  nombre: "Lote Tumaco 03",
  toneladas: "137",
  costoCopKg: "14500",
  ubicacion: "Bodega Buenaventura",
  fechaEmbarque: "2026-12-10",
  diferencialUsdTm: "250",
  tipoContrato: "por_fijar_ny",
};

describe("interpretarNumero", () => {
  it("lee el punto como separador de miles cuando agrupa de tres en tres", () => {
    expect(interpretarNumero("14.500")).toBe(14500);
    expect(interpretarNumero("1.234.567")).toBe(1234567);
  });

  it("lee el punto como decimal cuando no puede ser separador de miles", () => {
    // El navegador rellena los valores por defecto con el punto decimal de
    // JavaScript: leerlo como miles convertía 4,25 % en 425 %.
    expect(interpretarNumero("4.25")).toBe(4.25);
    expect(interpretarNumero("0.5")).toBe(0.5);
    expect(interpretarNumero("53.3")).toBe(53.3);
  });

  it("lee la coma como decimal", () => {
    expect(interpretarNumero("4,25")).toBe(4.25);
    expect(interpretarNumero("-150,5")).toBe(-150.5);
  });

  it("con ambos separadores manda el último", () => {
    expect(interpretarNumero("1.500,75")).toBe(1500.75);
    expect(interpretarNumero("1,500.75")).toBe(1500.75);
  });

  it("acepta enteros simples y descarta lo que no es número", () => {
    expect(interpretarNumero("252")).toBe(252);
    expect(interpretarNumero("  8000  ")).toBe(8000);
    expect(Number.isNaN(interpretarNumero(""))).toBe(true);
    expect(Number.isNaN(interpretarNumero("abc"))).toBe(true);
  });
});

describe("esquemaConfiguracion", () => {
  it("acepta los valores por defecto tal como los escribe el navegador", () => {
    // Con punto decimal, que es como React renderiza 4.25.
    const r = esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, tasaLibreRiesgoPorcentaje: "4.25" });
    expect(r.success).toBe(true);
    expect(r.data?.tasaLibreRiesgoPorcentaje).toBe(4.25);
  });

  it("acepta los valores por defecto", () => {
    const r = esquemaConfiguracion.safeParse(CONFIG_VALIDA);
    expect(r.success).toBe(true);
    expect(r.data?.tasaLibreRiesgoPorcentaje).toBe(4.25);
  });

  it("interpreta la coma decimal, que es como se escribe aquí", () => {
    const r = esquemaConfiguracion.safeParse({
      ...CONFIG_VALIDA,
      tasaLibreRiesgoPorcentaje: "4,25",
      volFallbackPorcentaje: "53,3",
    });
    expect(r.data?.volFallbackPorcentaje).toBe(53.3);
  });

  it("rechaza un mantenimiento superior al margen inicial", () => {
    // La posición nacería ya en llamada de margen.
    const r = esquemaConfiguracion.safeParse({
      ...CONFIG_VALIDA,
      margenInicialUsd: "5000",
      margenMantenimientoUsd: "6000",
    });
    expect(r.success).toBe(false);
    expect(erroresPorCampo(r.error!).margenMantenimientoUsd).toMatch(/no puede superar/i);
  });

  it("rechaza un nivel de confianza fuera de (50, 100)", () => {
    for (const valor of ["50", "100", "101", "0"]) {
      expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, nivelConfianzaVarPorcentaje: valor }).success).toBe(false);
    }
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, nivelConfianzaVarPorcentaje: "99" }).success).toBe(true);
  });

  it("rechaza una simulación demasiado pequeña o desmedida", () => {
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, trayectoriasMc: "100" }).success).toBe(false);
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, trayectoriasMc: "500000" }).success).toBe(false);
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, trayectoriasMc: "50000" }).success).toBe(true);
  });

  it("rechaza márgenes o volatilidades no positivos", () => {
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, margenInicialUsd: "0" }).success).toBe(false);
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, volFallbackPorcentaje: "0" }).success).toBe(false);
  });

  it("rechaza una base de días hábiles implausible", () => {
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, diasHabilesAnio: "100" }).success).toBe(false);
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, diasHabilesAnio: "400" }).success).toBe(false);
  });

  it("exige entero donde no tiene sentido un decimal", () => {
    expect(esquemaConfiguracion.safeParse({ ...CONFIG_VALIDA, diasHabilesAnio: "252,5" }).success).toBe(false);
  });
});

describe("esquemaLote", () => {
  it("acepta un lote completo", () => {
    expect(esquemaLote.safeParse(LOTE_VALIDO).success).toBe(true);
  });

  it("exige el precio pactado cuando el contrato es a precio fijo", () => {
    const sinPrecio = esquemaLote.safeParse({
      ...LOTE_VALIDO,
      tipoContrato: "precio_fijo_usd",
      precioVentaUsdTm: "",
    });
    expect(sinPrecio.success).toBe(false);
    expect(erroresPorCampo(sinPrecio.error!).precioVentaUsdTm).toMatch(/precio fijo/i);

    expect(
      esquemaLote.safeParse({
        ...LOTE_VALIDO,
        tipoContrato: "precio_fijo_usd",
        precioVentaUsdTm: "6400",
      }).success,
    ).toBe(true);
  });

  it("acepta un diferencial negativo: el descuento es tan válido como la prima", () => {
    const r = esquemaLote.safeParse({ ...LOTE_VALIDO, diferencialUsdTm: "-150" });
    expect(r.success).toBe(true);
    expect(r.data?.diferencialUsdTm).toBe(-150);
  });

  it("rechaza toneladas no positivas", () => {
    expect(esquemaLote.safeParse({ ...LOTE_VALIDO, toneladas: "0" }).success).toBe(false);
    expect(esquemaLote.safeParse({ ...LOTE_VALIDO, toneladas: "-5" }).success).toBe(false);
  });

  it("valida el formato del mes de vencimiento", () => {
    expect(esquemaLote.safeParse({ ...LOTE_VALIDO, mesFuturo: "Z26" }).success).toBe(true);
    // A no es código de mes del CC.
    expect(esquemaLote.safeParse({ ...LOTE_VALIDO, mesFuturo: "A26" }).success).toBe(false);
    expect(esquemaLote.safeParse({ ...LOTE_VALIDO, mesFuturo: "" }).success).toBe(true);
  });

  it("rechaza nombre o ubicación en blanco", () => {
    expect(esquemaLote.safeParse({ ...LOTE_VALIDO, nombre: "   " }).success).toBe(false);
    expect(esquemaLote.safeParse({ ...LOTE_VALIDO, ubicacion: "" }).success).toBe(false);
  });
});

describe("esquemaAnalisis · situación de cobertura", () => {
  const base = {
    toneladas: "15,275",
    costoCopKg: "16468",
    fechaEmbarque: "2026-12-10",
    diferencialUsdTm: "250",
    tipoContrato: "por_fijar_ny",
  };

  it("por defecto asume que hay cacao en bodega", () => {
    // Es el único caso que el motor sabe calcular.
    expect(esquemaAnalisis.safeParse(base).data?.situacion).toBe("tengo_cacao");
  });

  it("acepta las dos situaciones que existen en el negocio", () => {
    expect(esquemaAnalisis.safeParse({ ...base, situacion: "tengo_cacao" }).success).toBe(true);
    expect(esquemaAnalisis.safeParse({ ...base, situacion: "ya_vendi" }).success).toBe(true);
  });

  it("rechaza una situación inventada", () => {
    expect(esquemaAnalisis.safeParse({ ...base, situacion: "otra_cosa" }).success).toBe(false);
  });
});

describe("esquemaAnalisis", () => {
  it("acepta el origen de la serie o su ausencia", () => {
    const base = {
      toneladas: "137",
      costoCopKg: "14500",
      fechaEmbarque: "2026-12-10",
      diferencialUsdTm: "250",
      tipoContrato: "por_fijar_ny",
    };
    expect(esquemaAnalisis.safeParse(base).success).toBe(true);
    expect(esquemaAnalisis.safeParse({ ...base, origenCacao: "CCZ26|barchart_csv" }).success).toBe(true);
  });

  it("rechaza una fecha con formato inválido", () => {
    expect(
      esquemaAnalisis.safeParse({
        toneladas: "137", costoCopKg: "14500", fechaEmbarque: "10/12/2026",
        diferencialUsdTm: "250", tipoContrato: "por_fijar_ny",
      }).success,
    ).toBe(false);
  });
});

describe("erroresPorCampo", () => {
  it("aplana los errores a un mapa campo → mensaje", () => {
    const r = esquemaLote.safeParse({ ...LOTE_VALIDO, toneladas: "0", nombre: "" });
    const errores = erroresPorCampo(r.error!);
    expect(Object.keys(errores)).toContain("toneladas");
    expect(Object.keys(errores)).toContain("nombre");
  });
});
