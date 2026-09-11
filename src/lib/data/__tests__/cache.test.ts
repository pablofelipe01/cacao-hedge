import { describe, expect, it, vi } from "vitest";

import { obtenerSerieConCache } from "../cache";
import type { Barra, SerieHistorica } from "../tipos";

/**
 * Cliente simulado que además registra los filtros `.eq()` aplicados, para
 * poder comprobar por qué columnas consulta la caché.
 */
function espiarCliente(filas: Barra[], errorAlLeer?: { message: string }) {
  const filtros: [string, unknown][] = [];

  const constructor = {
    select: () => constructor,
    eq: (columna: string, valor: unknown) => {
      filtros.push([columna, valor]);
      return constructor;
    },
    gte: () => constructor,
    lte: () => constructor,
    order: () =>
      Promise.resolve({ data: errorAlLeer ? null : filas, error: errorAlLeer ?? null }),
  };

  return { cliente: { from: vi.fn(() => constructor) } as never, filtros };
}

/**
 * Cliente de Supabase simulado: reproduce la cadena de llamadas
 * `.from().select().eq().gte().lte().order()` que usa la caché.
 */
function clienteFalso(filas: Barra[], errorAlLeer?: { message: string }) {
  return espiarCliente(filas, errorAlLeer).cliente;
}

/** Cliente administrador simulado que registra los upserts. */
function adminFalso(error?: { message: string; code?: string }) {
  // Los parámetros se declaran para que `upsert.mock.calls` quede tipado.
  const upsert = vi.fn(
    (filas: Record<string, unknown>[], opciones: { onConflict: string }) => {
      void filas;
      void opciones;
      return Promise.resolve({ error: error ?? null });
    },
  );
  const cliente = { from: vi.fn(() => ({ upsert })) } as never;
  return { cliente, upsert };
}

function barra(fecha: string, cierre = 5900): Barra {
  return { fecha, apertura: null, maximo: null, minimo: null, cierre, volumen: null };
}

/** Serie cacheada suficiente y fresca respecto a `hasta`. */
function serieCacheada(hasta: string, n = 30): Barra[] {
  const barras: Barra[] = [];
  const fin = new Date(`${hasta}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const f = new Date(fin);
    f.setUTCDate(f.getUTCDate() - i);
    barras.push(barra(f.toISOString().slice(0, 10)));
  }
  return barras;
}

const SERIE_FRESCA: SerieHistorica = {
  serie: "CC",
  simbolo: "CC=F",
  fuente: "yahoo",
  barras: [barra("2026-09-10", 5886), barra("2026-09-11", 5911)],
};

const BASE = {
  serie: "CC" as const,
  simbolo: "CC=F",
  fuente: "yahoo" as const,
  desde: "2026-08-01",
  hasta: "2026-09-11",
};

describe("obtenerSerieConCache", () => {
  it("sirve desde la caché sin tocar la fuente cuando hay datos suficientes y frescos", async () => {
    const traerDeFuente = vi.fn(async () => SERIE_FRESCA);

    const resultado = await obtenerSerieConCache({
      ...BASE,
      cliente: clienteFalso(serieCacheada("2026-09-11")),
      traerDeFuente,
    });

    expect(resultado.desdeCache).toBe(true);
    expect(resultado.barras).toHaveLength(30);
    expect(traerDeFuente).not.toHaveBeenCalled();
  });

  it("consulta la fuente si la caché tiene pocas barras", async () => {
    const traerDeFuente = vi.fn(async () => SERIE_FRESCA);

    const resultado = await obtenerSerieConCache({
      ...BASE,
      cliente: clienteFalso([barra("2026-09-11")]),
      traerDeFuente,
    });

    expect(resultado.desdeCache).toBe(false);
    expect(traerDeFuente).toHaveBeenCalledOnce();
  });

  it("consulta la fuente si la última barra cacheada está vieja", async () => {
    const traerDeFuente = vi.fn(async () => SERIE_FRESCA);

    // 30 barras, pero la última es de hace más de `frescuraDias`.
    const resultado = await obtenerSerieConCache({
      ...BASE,
      cliente: clienteFalso(serieCacheada("2026-09-01")),
      traerDeFuente,
    });

    expect(resultado.desdeCache).toBe(false);
    expect(traerDeFuente).toHaveBeenCalledOnce();
  });

  it("guarda en la caché lo que trae de la fuente cuando hay cliente admin", async () => {
    const { cliente: admin, upsert } = adminFalso();

    const resultado = await obtenerSerieConCache({
      ...BASE,
      cliente: clienteFalso([]),
      clienteAdmin: admin,
      traerDeFuente: async () => SERIE_FRESCA,
    });

    expect(resultado.barrasGuardadas).toBe(2);
    expect(upsert).toHaveBeenCalledOnce();

    const [filas, opciones] = upsert.mock.calls[0];
    expect(opciones.onConflict).toBe("simbolo,fecha,fuente");
    expect(filas[0]).toMatchObject({ serie: "CC", simbolo: "CC=F", fuente: "yahoo", cierre: 5886 });
  });

  it("sin cliente admin devuelve la serie pero no intenta escribir", async () => {
    const resultado = await obtenerSerieConCache({
      ...BASE,
      cliente: clienteFalso([]),
      traerDeFuente: async () => SERIE_FRESCA,
    });

    expect(resultado.barras).toHaveLength(2);
    expect(resultado.barrasGuardadas).toBe(0);
  });

  it("degrada a la caché si la fuente externa falla: un dato viejo vale más que un error", async () => {
    const resultado = await obtenerSerieConCache({
      ...BASE,
      cliente: clienteFalso(serieCacheada("2026-09-01")),
      traerDeFuente: async () => {
        throw new Error("Yahoo caído");
      },
    });

    expect(resultado.desdeCache).toBe(true);
    expect(resultado.barras).toHaveLength(30);
  });

  it("propaga el error si la fuente falla y la caché está vacía", async () => {
    await expect(
      obtenerSerieConCache({
        ...BASE,
        cliente: clienteFalso([]),
        traerDeFuente: async () => {
          throw new Error("Yahoo caído");
        },
      }),
    ).rejects.toThrow(/Yahoo caído/);
  });

  it("explica que falta la service role key si RLS rechaza la escritura", async () => {
    const { cliente: admin } = adminFalso({ message: "row-level security", code: "42501" });

    await expect(
      obtenerSerieConCache({
        ...BASE,
        cliente: clienteFalso([]),
        clienteAdmin: admin,
        traerDeFuente: async () => SERIE_FRESCA,
      }),
    ).rejects.toMatchObject({ causa: "no_autorizado" });
  });

  it("filtra la caché por símbolo Y por fuente", async () => {
    // La restricción única es (simbolo, fecha, fuente): sin filtrar por
    // fuente se mezclarían series de proveedores distintos, que cotizan a
    // niveles distintos, y la volatilidad saldría inventada.
    const espia = espiarCliente(serieCacheada("2026-09-11"));

    await obtenerSerieConCache({
      ...BASE,
      cliente: espia.cliente,
      traerDeFuente: async () => SERIE_FRESCA,
    });

    expect(espia.filtros).toContainEqual(["simbolo", "CC=F"]);
    expect(espia.filtros).toContainEqual(["fuente", "yahoo"]);
  });

  it("informa con claridad si la lectura de la caché falla", async () => {
    await expect(
      obtenerSerieConCache({
        ...BASE,
        cliente: clienteFalso([], { message: "conexión perdida" }),
        traerDeFuente: async () => SERIE_FRESCA,
      }),
    ).rejects.toThrow(/No se pudo leer la caché/);
  });
});
