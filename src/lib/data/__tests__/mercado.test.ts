import { describe, expect, it, vi } from "vitest";

import { VOL_CACAO_RESPALDO, elegirProveedor, obtenerMercado } from "../mercado";
import type { Barra, PriceProvider, SerieHistorica } from "../tipos";

/** Cliente de Supabase simulado: la caché siempre responde vacía. */
function clienteVacio() {
  const constructor = {
    select: () => constructor,
    eq: () => constructor,
    gte: () => constructor,
    lte: () => constructor,
    order: () => Promise.resolve({ data: [], error: null }),
  };
  return { from: vi.fn(() => constructor) } as never;
}

/** Serie sintética de `n` días hábiles con retornos alternantes. */
function serie(n: number, inicio: number, paso = 0.01): Barra[] {
  const barras: Barra[] = [];
  let precio = inicio;
  const fecha = new Date("2026-09-11T00:00:00Z");

  for (let i = n - 1; i >= 0; i--) {
    const f = new Date(fecha);
    f.setUTCDate(f.getUTCDate() - i);
    barras.push({
      fecha: f.toISOString().slice(0, 10),
      apertura: null, maximo: null, minimo: null,
      cierre: Number(precio.toFixed(2)), volumen: null,
    });
    precio *= Math.exp(i % 2 === 0 ? paso : -paso);
  }
  return barras;
}

function proveedorFalso(barras: Barra[]): PriceProvider {
  return {
    nombre: "Falso",
    fuente: "yahoo",
    disponible: () => true,
    cotizacion: async () => {
      throw new Error("no usado");
    },
    historico: async (): Promise<SerieHistorica> => ({
      serie: "CC", simbolo: "CC=F", fuente: "yahoo", barras,
    }),
  };
}

/** Respuesta de Socrata con `n` días hábiles de TRM. */
function respuestaTrm(n: number, inicio = 3100) {
  const registros = serie(n, inicio, 0.004).map((b) => ({
    valor: String(b.cierre),
    unidad: "COP",
    vigenciadesde: `${b.fecha}T00:00:00.000`,
    vigenciahasta: `${b.fecha}T00:00:00.000`,
  }));

  return {
    ok: true, status: 200, statusText: "",
    headers: { get: () => null },
    json: async () => registros,
  } as unknown as Response;
}

const BASE = {
  cliente: clienteVacio(),
  hoy: "2026-09-11",
  opcionesTrm: { dormir: async () => {}, aleatorio: () => 0.5 },
};

describe("elegirProveedor", () => {
  it("usa Barchart cuando hay API key", () => {
    expect(elegirProveedor("clave-real").fuente).toBe("barchart_api");
  });

  it("cae a Yahoo sin API key: el sistema funciona completo gratis", () => {
    expect(elegirProveedor("").fuente).toBe("yahoo");
    expect(elegirProveedor("   ").fuente).toBe("yahoo");
  });
});

describe("obtenerMercado", () => {
  it("arma el Mercado con el último cierre, la TRM y ambas volatilidades", async () => {
    const resultado = await obtenerMercado({
      ...BASE,
      proveedor: proveedorFalso(serie(250, 5972)),
      opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
    });

    const { mercado } = resultado;
    expect(mercado.futuroUsdTm).toBeGreaterThan(0);
    expect(mercado.trm).toBeGreaterThan(0);
    expect(mercado.volAnualizada).toBeGreaterThan(0);
    expect(mercado.volTrmAnualizada).toBeGreaterThan(0);
    expect(mercado.fechaDatos).toBe("2026-09-11");
  });

  it("reporta la procedencia de cada serie", async () => {
    const { procedencia } = await obtenerMercado({
      ...BASE,
      proveedor: proveedorFalso(serie(250, 5972)),
      opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
    });

    expect(procedencia.cacao).toMatchObject({
      fuente: "yahoo", simbolo: "CC=F", barras: 250, desdeCache: false,
      volatilidadDeRespaldo: false,
    });
    expect(procedencia.trm).toMatchObject({
      fuente: "datos_gov_co", simbolo: "USDCOP", volatilidadDeRespaldo: false,
    });
  });

  it("advierte que Yahoo es orientativo y posiblemente diferido", async () => {
    const { advertencias } = await obtenerMercado({
      ...BASE,
      proveedor: proveedorFalso(serie(250, 5972)),
      opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
    });

    expect(advertencias.join(" ")).toMatch(/diferido/i);
  });

  it("respeta la volatilidad de respaldo que configuró el usuario", async () => {
    // El campo existía en la tabla pero no lo leía nadie: una opción que
    // no hace nada es peor que no tenerla.
    const { mercado, advertencias } = await obtenerMercado({
      ...BASE,
      proveedor: proveedorFalso(serie(5, 5972)),
      volCacaoRespaldo: 0.62,
      opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
    });

    expect(mercado.volAnualizada).toBe(0.62);
    expect(advertencias.join(" ")).toContain("62 %");
  });

  it("usa la volatilidad de respaldo y lo advierte si la serie es corta", async () => {
    const { mercado, advertencias, procedencia } = await obtenerMercado({
      ...BASE,
      proveedor: proveedorFalso(serie(5, 5972)),
      opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
    });

    expect(mercado.volAnualizada).toBe(VOL_CACAO_RESPALDO);
    expect(procedencia.cacao.volatilidadDeRespaldo).toBe(true);
    expect(advertencias.join(" ")).toMatch(/volatilidad de respaldo/i);
  });

  it("pide las dos series en paralelo, no en cadena", async () => {
    const orden: string[] = [];

    const proveedor: PriceProvider = {
      ...proveedorFalso(serie(250, 5972)),
      historico: async () => {
        orden.push("cacao:inicio");
        await new Promise((r) => setTimeout(r, 20));
        orden.push("cacao:fin");
        return { serie: "CC", simbolo: "CC=F", fuente: "yahoo", barras: serie(250, 5972) };
      },
    };

    await obtenerMercado({
      ...BASE,
      proveedor,
      opcionesTrm: {
        ...BASE.opcionesTrm,
        fetchImpl: async () => {
          orden.push("trm:inicio");
          return respuestaTrm(250);
        },
      },
    });

    // La TRM arranca antes de que termine el cacao: van en paralelo.
    expect(orden.indexOf("trm:inicio")).toBeLessThan(orden.indexOf("cacao:fin"));
  });

  it("avisa si el contrato no tuvo volumen el último día: está vencido o ilíquido", async () => {
    const barras = serie(250, 5961);
    // Un contrato expirado deja de negociarse aunque siga publicando precio.
    barras[barras.length - 1].volumen = 0;

    const { advertencias } = await obtenerMercado({
      ...BASE,
      proveedor: proveedorFalso(barras),
      opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
    });

    expect(advertencias.join(" ")).toMatch(/no registró volumen/i);
  });

  it("no avisa de liquidez si el contrato sí negoció", async () => {
    const barras = serie(250, 5961).map((b) => ({ ...b, volumen: 14_585 }));

    const { advertencias } = await obtenerMercado({
      ...BASE,
      proveedor: proveedorFalso(barras),
      opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
    });

    expect(advertencias.join(" ")).not.toMatch(/no registró volumen/i);
  });

  it("una serie importada no se intenta refrescar por red", async () => {
    // Pedirle a Yahoo un símbolo que solo existe en un CSV importado sería
    // absurdo: el error debe decir que hay que volver a importar.
    let consultoRed = false;
    const proveedor = {
      ...proveedorFalso([]),
      historico: async () => {
        consultoRed = true;
        throw new Error("no debería llamarse");
      },
    };

    await expect(
      obtenerMercado({
        ...BASE,
        proveedor,
        origenCacao: { simbolo: "CCZ26", fuente: "barchart_csv" },
        opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
      }),
    ).rejects.toThrow(/volver a importarla|importado/i);

    expect(consultoRed).toBe(false);
  });

  it("propaga el error si ninguna fuente responde y la caché está vacía", async () => {
    const proveedor: PriceProvider = {
      ...proveedorFalso([]),
      historico: async () => {
        throw new Error("Yahoo 429");
      },
    };

    await expect(
      obtenerMercado({
        ...BASE,
        proveedor,
        opcionesTrm: { ...BASE.opcionesTrm, fetchImpl: async () => respuestaTrm(250) },
      }),
    ).rejects.toThrow(/Yahoo 429/);
  });
});
