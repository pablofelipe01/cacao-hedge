import { describe, expect, it, vi } from "vitest";

import fixture from "./fixtures/yahoo-cc.json";
import { YahooProvider, normalizarChart, rangoParaDias } from "../yahoo";

function respuestaJson(cuerpo: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    headers: { get: () => null },
    json: async () => cuerpo,
  } as unknown as Response;
}

const SIN_ESPERAS = { dormir: async () => {}, aleatorio: () => 0.5 };

describe("rangoParaDias", () => {
  it("elige el rango predefinido que cubre los días pedidos", () => {
    expect(rangoParaDias(3)).toBe("5d");
    expect(rangoParaDias(30)).toBe("1mo");
    expect(rangoParaDias(90)).toBe("3mo");
    expect(rangoParaDias(365)).toBe("1y");
    expect(rangoParaDias(700)).toBe("2y");
    expect(rangoParaDias(5000)).toBe("10y");
  });
});

describe("normalizarChart", () => {
  it("convierte la respuesta real de Yahoo en barras", () => {
    const { barras, meta } = normalizarChart(fixture);

    expect(meta.currency).toBe("USD");
    expect(meta.symbol).toBe("CC=F");
    expect(barras.length).toBeGreaterThan(0);
    expect(barras[0]).toMatchObject({
      fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      cierre: expect.any(Number),
    });
  });

  it("descarta las barras sin cierre en vez de propagar nulos", () => {
    // El fixture tiene deliberadamente un cierre nulo entre 8 marcas.
    const { barras } = normalizarChart(fixture);
    expect(barras).toHaveLength(7);
    expect(barras.every((b) => Number.isFinite(b.cierre))).toBe(true);
  });

  it("deriva el día de negociación desde la zona horaria de la bolsa", () => {
    const { barras } = normalizarChart(fixture);
    // La primera marca del fixture es 2026-08-11T04:00Z con offset -4 h.
    expect(barras[0].fecha).toBe("2026-08-11");
  });

  it("mantiene el orden cronológico ascendente", () => {
    const { barras } = normalizarChart(fixture);
    const fechas = barras.map((b) => b.fecha);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it("propaga el error que reporta Yahoo", () => {
    expect(() =>
      normalizarChart({ chart: { result: null, error: { description: "No data found" } } }),
    ).toThrow(/No data found/);
  });

  it("falla con claridad si no hay resultados", () => {
    expect(() => normalizarChart({ chart: { result: [], error: null } })).toThrow(
      /no devolvió resultados/,
    );
  });
});

describe("YahooProvider", () => {
  it("siempre está disponible: no necesita credenciales", () => {
    expect(new YahooProvider().disponible()).toBe(true);
  });

  it("cotizacion prefiere regularMarketPrice sobre el último cierre", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson(fixture));
    const proveedor = new YahooProvider({ fetchImpl, ...SIN_ESPERAS });

    const cotizacion = await proveedor.cotizacion();

    expect(cotizacion.precio).toBe(fixture.chart.result[0].meta.regularMarketPrice);
    expect(cotizacion.serie).toBe("CC");
    expect(cotizacion.fuente).toBe("yahoo");
    expect(cotizacion.moneda).toBe("USD");
    expect(cotizacion.descripcion).toBe("Cocoa Dec 26");
  });

  it("historico recorta al rango exacto pedido", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson(fixture));
    const proveedor = new YahooProvider({ fetchImpl, ...SIN_ESPERAS });

    const serie = await proveedor.historico({ desde: "2026-08-13", hasta: "2026-08-18" });

    expect(serie.barras.every((b) => b.fecha >= "2026-08-13" && b.fecha <= "2026-08-18")).toBe(true);
    expect(serie.simbolo).toBe("CC=F");
    expect(serie.fuente).toBe("yahoo");
  });

  it("falla con mensaje claro si el rango no tiene barras", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson(fixture));
    const proveedor = new YahooProvider({ fetchImpl, ...SIN_ESPERAS });

    await expect(
      proveedor.historico({ desde: "2020-01-01", hasta: "2020-01-31" }),
    ).rejects.toMatchObject({ causa: "sin_datos" });
  });

  it("envía user-agent de navegador: Yahoo rechaza las peticiones sin él", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson(fixture));
    await new YahooProvider({ fetchImpl, ...SIN_ESPERAS }).cotizacion();

    const [, opciones] = fetchImpl.mock.calls[0];
    expect((opciones?.headers as Record<string, string>)["User-Agent"]).toMatch(/Mozilla/);
  });
});
