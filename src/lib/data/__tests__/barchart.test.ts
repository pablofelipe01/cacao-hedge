import { describe, expect, it, vi } from "vitest";

import {
  BarchartProvider,
  SIMBOLO_CONTINUO_BARCHART,
  aFechaBarchart,
  normalizarBarras,
  validarSobre,
} from "../barchart";

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
const OK = { status: { code: 200 } };

describe("aFechaBarchart", () => {
  it("convierte ISO a aaaammdd", () => {
    expect(aFechaBarchart("2026-09-11")).toBe("20260911");
  });
});

describe("validarSobre", () => {
  it("devuelve los resultados cuando el código es 200", () => {
    expect(validarSobre({ ...OK, results: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it("detecta el fallo aunque el HTTP sea 200: el código real va en el cuerpo", () => {
    expect(() => validarSobre({ status: { code: 401 }, results: null })).toThrow(/API key/);
    expect(() => validarSobre({ status: { code: 429 }, results: null })).toThrow(/cuota/);
    expect(() =>
      validarSobre({ status: { code: 500, message: "Server error" }, results: null }),
    ).toThrow(/500/);
  });

  it("clasifica el 401 como no autorizado y no reintentable", () => {
    try {
      validarSobre({ status: { code: 401 }, results: null });
      expect.unreachable("debía lanzar");
    } catch (error) {
      expect(error).toMatchObject({ causa: "no_autorizado", reintentable: false });
    }
  });

  it("trata la lista vacía como falta de datos", () => {
    expect(() => validarSobre({ ...OK, results: [] })).toThrow(/no devolvió resultados/);
  });
});

describe("normalizarBarras", () => {
  it("usa tradingDay y ordena ascendente", () => {
    const barras = normalizarBarras([
      { symbol: "CCZ26", tradingDay: "2026-09-11", open: 5963, high: 6203, low: 5892, close: 5911, volume: 14171 },
      { symbol: "CCZ26", tradingDay: "2026-09-10", close: 5886 },
    ]);

    expect(barras.map((b) => b.fecha)).toEqual(["2026-09-10", "2026-09-11"]);
    expect(barras[1]).toMatchObject({ apertura: 5963, cierre: 5911, volumen: 14171 });
    expect(barras[0]).toMatchObject({ apertura: null, maximo: null, volumen: null });
  });

  it("cae a timestamp si no hay tradingDay", () => {
    const [barra] = normalizarBarras([{ symbol: "CC*1", timestamp: "2026-09-11T18:00:00-04:00", close: 5911 }]);
    expect(barra.fecha).toBe("2026-09-11");
  });

  it("descarta barras sin cierre o sin fecha", () => {
    expect(
      normalizarBarras([
        { symbol: "X", tradingDay: "2026-09-11" },
        { symbol: "X", close: 100 },
        { symbol: "X", tradingDay: "2026-09-11", close: 100 },
      ]),
    ).toHaveLength(1);
  });
});

describe("BarchartProvider", () => {
  it("no está disponible sin API key", () => {
    const proveedor = new BarchartProvider("");
    expect(proveedor.disponible()).toBe(false);
    expect(proveedor.motivoNoDisponible()).toMatch(/producto aparte/i);
  });

  it("ignora una API key en blanco", () => {
    expect(new BarchartProvider("   ").disponible()).toBe(false);
  });

  it("está disponible con API key", () => {
    expect(new BarchartProvider("clave").disponible()).toBe(true);
  });

  it("falla con causa sin_credenciales antes de tocar la red", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const proveedor = new BarchartProvider("", { fetchImpl, ...SIN_ESPERAS });

    await expect(proveedor.cotizacion()).rejects.toMatchObject({ causa: "sin_credenciales" });
    await expect(proveedor.historico({ desde: "2026-01-01" })).rejects.toMatchObject({
      causa: "sin_credenciales",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("consulta getQuote con el continuo por defecto", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      respuestaJson({ ...OK, results: [{ symbol: "CCZ26", name: "Cocoa Dec 26", lastPrice: 5911, tradeTimestamp: "2026-09-11T18:00:00-04:00" }] }),
    );
    const cotizacion = await new BarchartProvider("k123", { fetchImpl, ...SIN_ESPERAS }).cotizacion();

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("getQuote.json");
    expect(url).toContain("apikey=k123");
    expect(url).toContain(encodeURIComponent(SIMBOLO_CONTINUO_BARCHART));

    expect(cotizacion).toMatchObject({ precio: 5911, simbolo: "CCZ26", fuente: "barchart_api" });
  });

  it("consulta getHistory con fechas en formato aaaammdd", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      respuestaJson({ ...OK, results: [{ symbol: "CC*1", tradingDay: "2026-09-11", close: 5911 }] }),
    );

    await new BarchartProvider("k123", { fetchImpl, ...SIN_ESPERAS }).historico({
      desde: "2026-01-01",
      hasta: "2026-09-11",
    });

    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain("getHistory.json");
    expect(url).toContain("startDate=20260101");
    expect(url).toContain("endDate=20260911");
    expect(url).toContain("type=daily");
  });
});
