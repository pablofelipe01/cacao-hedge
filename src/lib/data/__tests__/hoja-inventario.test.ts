import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  aToneladas,
  descargarInventario,
  fechaDeCelda,
  interpretarHoja,
  localizarColumnas,
  numeroDeCelda,
  parsearCsv,
  urlExportacion,
} from "../hoja-inventario";

const HOJA = readFileSync(
  fileURLToPath(new URL("./fixtures/hoja-inventario.csv", import.meta.url)),
  "utf8",
);

const SIN_ESPERAS = { dormir: async () => {}, aleatorio: () => 0.5 };

function respuestaTexto(cuerpo: string) {
  return {
    ok: true,
    status: 200,
    statusText: "",
    headers: { get: () => null },
    text: async () => cuerpo,
  } as unknown as Response;
}

describe("parsearCsv", () => {
  it("respeta las comas dentro de comillas", () => {
    expect(parsearCsv('a,"1,5",c')[0]).toEqual(["a", "1,5", "c"]);
  });

  it("conserva las celdas vacías, que definen la posición de columna", () => {
    expect(parsearCsv("a,,c")[0]).toEqual(["a", "", "c"]);
  });
});

describe("numeroDeCelda", () => {
  it("interpreta la convención colombiana", () => {
    expect(numeroDeCelda("15.274,65")).toBe(15274.65);
    expect(numeroDeCelda("1580,6")).toBe(1580.6);
    expect(numeroDeCelda("12442")).toBe(12442);
  });

  it("quita el símbolo de peso de la columna de valor de compra", () => {
    expect(numeroDeCelda(" $13.850")).toBe(13850);
  });

  it("descarta los errores de fórmula de la hoja", () => {
    expect(numeroDeCelda("#DIV/0!")).toBeNull();
    expect(numeroDeCelda("")).toBeNull();
    expect(numeroDeCelda(undefined)).toBeNull();
  });
});

describe("fechaDeCelda", () => {
  it("entiende los meses abreviados en español que usa la hoja", () => {
    expect(fechaDeCelda("2-jul-2026")).toBe("2026-07-02");
    expect(fechaDeCelda("9-sept-2026")).toBe("2026-09-09");
    expect(fechaDeCelda("31-dic-2025")).toBe("2025-12-31");
  });

  it("entiende también el formato numérico", () => {
    expect(fechaDeCelda("22/11/25")).toBe("2025-11-22");
    expect(fechaDeCelda("20/12/2025")).toBe("2025-12-20");
  });

  it("devuelve null en vez de inventar una fecha", () => {
    expect(fechaDeCelda("")).toBeNull();
    expect(fechaDeCelda("sin fecha")).toBeNull();
    expect(fechaDeCelda("31-feb-2026")).toBeNull();
  });
});

describe("localizarColumnas", () => {
  it("toma la PRIMERA columna de disponible, no la de clasificación", () => {
    // La hoja tiene dos columnas con ese mismo nombre: la de ENTRADAS
    // (columna O, índice 14) y otra desglosada por calidad más adelante.
    // Sumar la segunda contaría el inventario dos veces.
    const col = localizarColumnas(parsearCsv(HOJA));
    expect(col.disponible).toBe(14);
  });

  it("localiza el resto de columnas por su encabezado", () => {
    const col = localizarColumnas(parsearCsv(HOJA));
    expect(col.codigo).toBe(4);
    expect(col.valorCompra).toBe(8);
    expect(col.ingresada).toBe(12);
    expect(col.salida).toBe(13);
  });

  it("falla con un mensaje útil si la hoja cambió de estructura", () => {
    expect(() => localizarColumnas([["Fecha", "Otra cosa"]])).toThrow(
      /CANTIDAD DISPONIBLE EN BODEGA/,
    );
  });

  it("detecta si el disponible aparece antes que la salida", () => {
    // Señal de que alguien reordenó columnas: mejor fallar que sumar mal.
    const invertido = [["", "", "", "", "CODIGO  DE PROCEDENCIA", "CANTIDAD DISPONIBLE EN BODEGA", "CANTIDAD SALIDA"]];
    expect(() => localizarColumnas(invertido)).toThrow(/estructura de la hoja cambió/);
  });
});

describe("interpretarHoja", () => {
  const inventario = interpretarHoja(HOJA);

  it("devuelve solo las filas con saldo", () => {
    expect(inventario.filas.length).toBeGreaterThan(0);
    expect(inventario.filas.every((f) => f.cantidadDisponibleKg > 0)).toBe(true);
  });

  it("ignora las filas sin código: son totales o plantilla", () => {
    expect(inventario.filas.every((f) => f.codigoProcedencia.length > 0)).toBe(true);
  });

  it("captura el total que declara la propia hoja", () => {
    expect(inventario.totalDeclaradoKg).toBe(15274.65);
  });

  it("avisa cuando su suma no coincide con el total declarado", () => {
    // El fixture es un recorte: su suma no puede dar el total de la hoja
    // completa, y eso es exactamente lo que debe detectarse.
    expect(inventario.totalCuadra).toBe(false);
  });

  it("guarda el número de fila para poder rastrear cada cifra", () => {
    for (const fila of inventario.filas) {
      expect(fila.fila).toBeGreaterThan(0);
    }
  });

  it("suma en kilogramos y convierte a toneladas", () => {
    expect(inventario.totalKg).toBeCloseTo(
      inventario.filas.reduce((a, f) => a + f.cantidadDisponibleKg, 0),
      6,
    );
    expect(aToneladas(15274.65)).toBeCloseTo(15.27465, 9);
  });
});

describe("descargarInventario", () => {
  it("construye la URL de exportación a CSV", () => {
    expect(urlExportacion("abc123")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/export?format=csv",
    );
  });

  it("descarga e interpreta la hoja", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => respuestaTexto(HOJA));
    const inventario = await descargarInventario("abc123", { fetchImpl, ...SIN_ESPERAS });

    expect(inventario.filas.length).toBeGreaterThan(0);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("format=csv");
  });

  it("explica con claridad si la hoja no es pública", async () => {
    // Google devuelve la página de login en HTML, no un CSV.
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      respuestaTexto("<!DOCTYPE html><html><head><title>Sign in</title>"),
    );

    await expect(
      descargarInventario("abc123", { fetchImpl, ...SIN_ESPERAS }),
    ).rejects.toMatchObject({ causa: "no_autorizado" });
  });
});
