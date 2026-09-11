import { describe, expect, it, vi } from "vitest";

import registros from "./fixtures/trm.json";
import { normalizarRegistros, trmHistorica, trmVigente } from "../trm";

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

describe("normalizarRegistros", () => {
  it("convierte los registros reales de Socrata en barras", () => {
    const barras = normalizarRegistros(registros);

    expect(barras).toHaveLength(10);
    expect(barras[0].fecha).toBe("2026-08-28");
    expect(barras.at(-1)).toMatchObject({ fecha: "2026-09-11", cierre: 3101 });
  });

  it("ordena cronológicamente aunque Socrata devuelva descendente", () => {
    // El fixture viene en orden descendente.
    expect(registros[0].vigenciadesde > registros[1].vigenciadesde).toBe(true);

    const fechas = normalizarRegistros(registros).map((b) => b.fecha);
    expect([...fechas].sort()).toEqual(fechas);
  });

  it("indexa por vigenciadesde: una vigencia multi-día es una sola observación", () => {
    // El registro 2026-09-05 → 2026-09-08 cubre cuatro días calendario
    // pero aporta un único retorno a la serie de días hábiles.
    const barras = normalizarRegistros(registros);
    expect(barras.filter((b) => b.fecha === "2026-09-05")).toHaveLength(1);
    expect(barras.some((b) => b.fecha === "2026-09-06")).toBe(false);
    expect(barras.some((b) => b.fecha === "2026-09-07")).toBe(false);
  });

  it("la TRM no tiene OHLC: solo cierre", () => {
    const [barra] = normalizarRegistros(registros);
    expect(barra.apertura).toBeNull();
    expect(barra.maximo).toBeNull();
    expect(barra.minimo).toBeNull();
    expect(barra.volumen).toBeNull();
  });

  it("descarta registros corruptos en vez de propagar NaN", () => {
    const barras = normalizarRegistros([
      { valor: "3100", vigenciadesde: "2026-09-11T00:00:00.000" },
      { valor: "no-es-numero", vigenciadesde: "2026-09-10T00:00:00.000" },
      { valor: "-5", vigenciadesde: "2026-09-09T00:00:00.000" },
      { valor: "3050", vigenciadesde: "fecha-mala" },
      {},
    ]);

    expect(barras).toHaveLength(1);
    expect(barras[0].cierre).toBe(3100);
  });
});

describe("trmVigente", () => {
  it("pide el registro más reciente, no el de hoy", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson([registros[0]]));
    const cotizacion = await trmVigente({ fetchImpl, ...SIN_ESPERAS });

    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("vigenciadesde%20DESC");
    expect(String(url)).toContain("limit=1");

    expect(cotizacion).toMatchObject({
      serie: "TRM",
      simbolo: "USDCOP",
      fuente: "datos_gov_co",
      precio: 3101,
      fecha: "2026-09-11",
      moneda: "COP",
    });
  });

  it("falla con causa sin_datos si el portal devuelve vacío", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson([]));
    await expect(trmVigente({ fetchImpl, ...SIN_ESPERAS })).rejects.toMatchObject({
      causa: "sin_datos",
    });
  });
});

describe("trmHistorica", () => {
  it("filtra por rango con SoQL y ordena ascendente", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson(registros));
    const serie = await trmHistorica(
      { desde: "2026-08-28", hasta: "2026-09-11" },
      { fetchImpl, ...SIN_ESPERAS },
    );

    // URLSearchParams codifica los espacios como "+", que Socrata acepta
    // igual que %20 (verificado contra la API real).
    const url = decodeURIComponent(String(fetchImpl.mock.calls[0][0])).replaceAll("+", " ");
    expect(url).toContain("vigenciadesde >= '2026-08-28T00:00:00'");
    expect(url).toContain("vigenciadesde <= '2026-09-11T23:59:59'");
    expect(url).toContain("vigenciadesde ASC");

    expect(serie.serie).toBe("TRM");
    expect(serie.barras).toHaveLength(10);
  });

  it("envía el token de aplicación cuando está configurado", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson(registros));
    await trmHistorica(
      { desde: "2026-08-28" },
      { fetchImpl, appToken: "tok123", ...SIN_ESPERAS },
    );

    const [, opciones] = fetchImpl.mock.calls[0];
    expect((opciones?.headers as Record<string, string>)["X-App-Token"]).toBe("tok123");
  });

  it("informa con claridad si no hay TRM en el rango", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaJson([]));
    await expect(
      trmHistorica({ desde: "1990-01-01", hasta: "1990-12-31" }, { fetchImpl, ...SIN_ESPERAS }),
    ).rejects.toThrow(/No hay TRM publicada/);
  });
});
