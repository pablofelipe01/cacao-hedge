import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { existsSync, readFileSync as leerArchivo } from "node:fs";

import {
  aFechaIsoFlexible,
  aNumero,
  detectarSeparador,
  dividirLineaCsv,
  importarCsv,
  simboloDesdeNombreArchivo,
} from "../csv";

const CSV_BARCHART = readFileSync(
  fileURLToPath(new URL("./fixtures/barchart-historico.csv", import.meta.url)),
  "utf8",
);

describe("dividirLineaCsv", () => {
  it("separa campos simples", () => {
    expect(dividirLineaCsv("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("respeta las comas dentro de comillas", () => {
    expect(dividirLineaCsv('"Cocoa, Dec 26","5,911.00",14171')).toEqual([
      "Cocoa, Dec 26",
      "5,911.00",
      "14171",
    ]);
  });

  it("interpreta las comillas dobles escapadas", () => {
    expect(dividirLineaCsv('"dijo ""hola""",x')).toEqual(['dijo "hola"', "x"]);
  });

  it("conserva los campos vacíos", () => {
    expect(dividirLineaCsv("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("detectarSeparador", () => {
  it("detecta coma, punto y coma y tabulador", () => {
    expect(detectarSeparador("a,b,c\n1,2,3")).toBe(",");
    expect(detectarSeparador("a;b;c\n1;2;3")).toBe(";");
    expect(detectarSeparador("a\tb\tc")).toBe("\t");
  });

  it("ante la duda se queda con la coma", () => {
    expect(detectarSeparador("solo-un-campo")).toBe(",");
  });
});

describe("aNumero", () => {
  it("quita separadores de miles y comillas", () => {
    expect(aNumero('"5,911.00"')).toBe(5911);
    expect(aNumero("14,171")).toBe(14171);
    expect(aNumero("6203")).toBe(6203);
  });

  it("devuelve null ante celdas no numéricas", () => {
    expect(aNumero("")).toBeNull();
    expect(aNumero("N/A")).toBeNull();
    expect(aNumero("-")).toBeNull();
    expect(aNumero("Downloaded from Barchart")).toBeNull();
    expect(aNumero(undefined)).toBeNull();
  });
});

describe("aFechaIsoFlexible", () => {
  it("acepta ISO tal cual", () => {
    expect(aFechaIsoFlexible("2026-09-11")).toBe("2026-09-11");
    expect(aFechaIsoFlexible("2026-09-11T00:00:00Z")).toBe("2026-09-11");
  });

  it("interpreta mm/dd/aaaa, que es lo que exporta Barchart", () => {
    expect(aFechaIsoFlexible("09/11/2026")).toBe("2026-09-11");
    expect(aFechaIsoFlexible("12/01/2026")).toBe("2026-12-01");
  });

  it("deduce dd/mm/aaaa cuando el primer componente no puede ser mes", () => {
    expect(aFechaIsoFlexible("25/12/2026")).toBe("2026-12-25");
  });

  it("con diaPrimero resuelve la ambigüedad hacia dd/mm/aaaa", () => {
    // La misma cadena se lee distinto según el origen del archivo.
    expect(aFechaIsoFlexible("11/09/2026")).toBe("2026-11-09");
    expect(aFechaIsoFlexible("11/09/2026", true)).toBe("2026-09-11");
    // Si el primer componente no puede ser mes, el indicio es irrelevante.
    expect(aFechaIsoFlexible("25/12/2026", false)).toBe("2026-12-25");
  });

  it("acepta aaaa/mm/dd y guiones", () => {
    expect(aFechaIsoFlexible("2026/09/11")).toBe("2026-09-11");
    expect(aFechaIsoFlexible("09-11-2026")).toBe("2026-09-11");
  });

  it("expande los años de dos cifras", () => {
    expect(aFechaIsoFlexible("09/11/26")).toBe("2026-09-11");
    expect(aFechaIsoFlexible("09/11/98")).toBe("1998-09-11");
  });

  it("rechaza lo que no es fecha", () => {
    expect(aFechaIsoFlexible("Downloaded from Barchart.com")).toBeNull();
    expect(aFechaIsoFlexible("")).toBeNull();
    expect(aFechaIsoFlexible("2026-13-45")).toBeNull();
  });
});

describe("importarCsv", () => {
  it("interpreta un export real de Barchart", () => {
    const serie = importarCsv(CSV_BARCHART);

    expect(serie.fuente).toBe("barchart_csv");
    expect(serie.serie).toBe("CC");
    expect(serie.simbolo).toBe("CCZ26");
    expect(serie.barras).toHaveLength(3);
  });

  it("encuentra el encabezado aunque no sea la primera línea", () => {
    // El fixture empieza con una línea de título del contrato.
    expect(CSV_BARCHART.split("\n")[0]).toContain("Cocoa (ICE US)");
    expect(importarCsv(CSV_BARCHART).barras.length).toBeGreaterThan(0);
  });

  it("ordena de más antiguo a más reciente aunque Barchart exporte al revés", () => {
    const fechas = importarCsv(CSV_BARCHART).barras.map((b) => b.fecha);
    expect(fechas).toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
  });

  it("descarta el pie de página y las filas sin datos", () => {
    const serie = importarCsv(CSV_BARCHART);
    // La fila del 09/08 viene vacía y la última línea es la marca de descarga.
    expect(serie.filasDescartadas).toBe(2);
    expect(serie.barras.some((b) => b.fecha === "2026-09-08")).toBe(false);
  });

  it("convierte los números con separador de miles", () => {
    const ultima = importarCsv(CSV_BARCHART).barras.at(-1)!;
    expect(ultima).toMatchObject({
      fecha: "2026-09-11",
      apertura: 5963,
      maximo: 6203,
      minimo: 5892,
      cierre: 5911,
      volumen: 14171,
    });
  });

  it("deja en null las celdas no numéricas sin descartar la fila", () => {
    const barra = importarCsv(CSV_BARCHART).barras.find((b) => b.fecha === "2026-09-09")!;
    expect(barra.volumen).toBeNull();
    expect(barra.cierre).toBe(5902);
  });

  it("interpreta el export real de futuros: columnas Time y Last", () => {
    // Barchart exporta los futuros con «Time» en vez de «Date» y «Last»
    // en vez de «Close», precedidos de una línea de título del contrato.
    const serie = importarCsv(
      [
        `"Cocoa Dec \'26 (CCZ26)"`,
        `"Symbol","Time","Open","High","Low","Last","Change","Volume","Open Interest"`,
        `"CCZ26","09/11/2026","5963.00","6203.00","5892.00","5911.00","+25.00","14171","98765"`,
        `"CCZ26","09/10/2026","5901.00","5980.00","5855.00","5886.00","-16.00","12004","98101"`,
        `"Downloaded from Barchart.com as of 09/11/2026"`,
      ].join("\n"),
      "CC=F",
    );

    expect(serie.simbolo).toBe("CCZ26");
    expect(serie.barras).toHaveLength(2);
    expect(serie.filasDescartadas).toBe(1);
    expect(serie.barras.at(-1)).toMatchObject({
      fecha: "2026-09-11",
      apertura: 5963,
      maximo: 6203,
      minimo: 5892,
      cierre: 5911,
      volumen: 14171,
    });
  });

  it("acepta un CSV mínimo de solo fecha y cierre", () => {
    const serie = importarCsv("Date,Close\n2026-09-10,5886\n2026-09-11,5911\n", "CCZ26");
    expect(serie.simbolo).toBe("CCZ26");
    expect(serie.barras).toEqual([
      { fecha: "2026-09-10", apertura: null, maximo: null, minimo: null, cierre: 5886, volumen: null },
      { fecha: "2026-09-11", apertura: null, maximo: null, minimo: null, cierre: 5911, volumen: null },
    ]);
  });

  it("acepta CSV con punto y coma, como el que reescribe Excel en es-CO", () => {
    // Con ";" como separador de campos, la coma pasa a ser el decimal.
    const serie = importarCsv(
      "Fecha;Apertura;Maximo;Minimo;Cierre;Volumen\n11/09/2026;5.963,00;6.203,00;5.892,00;5.911,50;14.171\n",
      "CCZ26",
    );

    expect(serie.barras).toHaveLength(1);
    expect(serie.barras[0]).toMatchObject({
      fecha: "2026-09-11",
      apertura: 5963,
      maximo: 6203,
      minimo: 5892,
      cierre: 5911.5,
      volumen: 14171,
    });
  });

  it("elimina fechas duplicadas quedándose con la última leída", () => {
    const serie = importarCsv("Date,Close\n2026-09-11,5900\n2026-09-11,5911\n");
    expect(serie.barras).toHaveLength(1);
    expect(serie.barras[0].cierre).toBe(5911);
  });

  it("permite importar una serie de TRM", () => {
    const serie = importarCsv("Fecha,Cierre\n2026-09-11,3101\n", "USDCOP", "TRM");
    expect(serie.serie).toBe("TRM");
    expect(serie.simbolo).toBe("USDCOP");
    expect(serie.barras[0].cierre).toBe(3101);
  });

  it("explica qué falta si no hay columnas reconocibles", () => {
    expect(() => importarCsv("foo,bar\n1,2\n")).toThrow(/fecha y cierre/);
  });

  it("rechaza un archivo vacío", () => {
    expect(() => importarCsv("")).toThrow(/vacío/);
  });

  it("rechaza un CSV con encabezado pero sin filas válidas", () => {
    expect(() => importarCsv("Date,Close\nDownloaded from Barchart.com,\n")).toThrow(
      /ninguna fila con fecha y cierre/,
    );
  });
});

describe("simboloDesdeNombreArchivo", () => {
  it("extrae el contrato del nombre que pone Barchart", () => {
    expect(simboloDesdeNombreArchivo("ccz26_price-history-09-11-2026.csv")).toBe("CCZ26");
    expect(simboloDesdeNombreArchivo("ccu26_price-history-09-11-2026.csv")).toBe("CCU26");
  });

  it("acepta los códigos de mes de futuros y rechaza el resto", () => {
    expect(simboloDesdeNombreArchivo("ccf26.csv")).toBe("CCF26");
    expect(simboloDesdeNombreArchivo("ccm26.csv")).toBe("CCM26");
    // "A" no es código de mes válido.
    expect(simboloDesdeNombreArchivo("cca26.csv")).toBeNull();
  });

  it("no bautiza una serie con cualquier nombre de archivo", () => {
    expect(simboloDesdeNombreArchivo("mis-datos.csv")).toBeNull();
    expect(simboloDesdeNombreArchivo("export (1).csv")).toBeNull();
    expect(simboloDesdeNombreArchivo("precios2026.csv")).toBeNull();
  });
});

/**
 * Los históricos de barchart.com no se versionan: son datos de un
 * proveedor comercial. Estos tests se saltan solos cuando no están, para
 * que un clon limpio no falle, y se ejecutan en cuanto alguien los baja.
 */
const RUTA_CCZ26 = "docs/ccz26_price-history-09-11-2026.csv";
const hayHistoricos = existsSync(RUTA_CCZ26);

describe.skipIf(!hayHistoricos)("históricos reales de barchart.com", () => {
  const REALES = [
    { archivo: "ccz26_price-history-09-11-2026.csv", simbolo: "CCZ26", barras: 426 },
    { archivo: "ccu26_price-history-09-11-2026.csv", simbolo: "CCU26", barras: 490 },
  ];

  it.each(REALES)("interpreta $archivo sin editarlo", ({ archivo, simbolo, barras }) => {
    const detectado = simboloDesdeNombreArchivo(archivo)!;
    const serie = importarCsv(leerArchivo(`docs/${archivo}`, "utf8"), detectado, "CC");

    expect(detectado).toBe(simbolo);
    expect(serie.simbolo).toBe(simbolo);
    expect(serie.barras).toHaveLength(barras);
    // La única línea descartada es el pie de descarga.
    expect(serie.filasDescartadas).toBe(1);
    expect(serie.fuente).toBe("barchart_csv");
  });

  it("lee la columna «Latest», que es como Barchart nombra el cierre", () => {
    const serie = importarCsv(leerArchivo(RUTA_CCZ26, "utf8"), "CCZ26", "CC");
    const ultima = serie.barras.at(-1)!;

    expect(ultima).toMatchObject({
      fecha: "2026-09-11",
      apertura: 5963,
      maximo: 6203,
      minimo: 5892,
      cierre: 5961,
      volumen: 14585,
    });
  });

  it("entrega la serie en orden cronológico con cierres utilizables", () => {
    const serie = importarCsv(leerArchivo(RUTA_CCZ26, "utf8"), "CCZ26", "CC");
    const fechas = serie.barras.map((b) => b.fecha);

    expect([...fechas].sort()).toEqual(fechas);
    expect(serie.barras.every((b) => Number.isFinite(b.cierre) && b.cierre > 0)).toBe(true);
  });
});
