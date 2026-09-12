/**
 * El parser de la hoja de precios de Nacional y Luker.
 *
 * La hoja la mantiene una persona a mano, así que lo que se prueba aquí
 * no es tanto el caso feliz como las formas de romperse: una fila movida,
 * una fecha en formato de rango, una celda con basura.
 */
import { describe, expect, it } from "vitest";

import {
  calcularDescuentos,
  fechaDeCabecera,
  interpretarHojaPrecios,
  precioDeCelda,
  resumirDescuento,
} from "../hoja-precios-productor";

/** Una hoja mínima con la misma forma que la real. */
function hoja({
  rotuloLuker = "Bajo Cadmio",
  fechas = ["11-sept-26", "10-sept-26"],
  luker = ["$15.650", "$15.300"],
} = {}): string {
  const filas = Array.from({ length: 13 }, () => ["", "", ""]);
  filas[8] = ["FECHA", ...fechas];
  filas[9] = [rotuloLuker, ...luker];
  filas[10] = ["Alto Cadmio", "$15.350", "$15.000"];
  filas[11] = ["Más $500 premium", "$15.300", "$15.300"];
  filas[12] = ["Más $500 premium", "$15.250", "$15.250"];
  return filas.map((f) => f.join(",")).join("\n");
}

describe("fechas de la cabecera", () => {
  it("lee el formato de la hoja", () => {
    expect(fechaDeCabecera("11-sept-26")).toBe("2026-09-11");
    expect(fechaDeCabecera("4-sep-25")).toBe("2025-09-04");
    expect(fechaDeCabecera("1-ene-25")).toBe("2025-01-01");
  });

  it("descarta los rangos de semana en vez de inventarles un día", () => {
    // Las columnas viejas traen «4 al 10 Jun-20»: no son una fecha.
    expect(fechaDeCabecera("4 al 10 Jun-20")).toBeNull();
    expect(fechaDeCabecera("")).toBeNull();
    expect(fechaDeCabecera("FECHA")).toBeNull();
  });
});

describe("precios", () => {
  it("lee el formato colombiano con símbolo de peso", () => {
    expect(precioDeCelda("$15.650")).toBe(15650);
    expect(precioDeCelda(" $ 6.850 ")).toBe(6850);
  });

  it("rechaza lo que no puede ser un precio de cacao", () => {
    expect(precioDeCelda("#REF!")).toBeNull();
    expect(precioDeCelda("")).toBeNull();
    // 30 y 165.000 aparecen en la hoja en filas que no son de precio.
    expect(precioDeCelda("30")).toBeNull();
    expect(precioDeCelda("$165.000")).toBeNull();
  });
});

describe("interpretación de la hoja", () => {
  it("saca un precio por comprador y fecha", () => {
    const r = interpretarHojaPrecios(hoja());
    expect(r.precios).toHaveLength(8); // 4 compradores × 2 fechas
    expect(r.ultimaFecha).toBe("2026-09-11");
    expect(
      r.precios.find((p) => p.fecha === "2026-09-11" && p.comprador === "luker_bajo_cadmio")
        ?.precioCopKg,
    ).toBe(15650);
  });

  it("revienta si alguien mueve una fila", () => {
    // Es el fallo que importa: leer el alto cadmio creyendo que es el
    // bajo daría un precio 300 COP/kg equivocado sin avisar a nadie.
    expect(() => interpretarHojaPrecios(hoja({ rotuloLuker: "Otra cosa" }))).toThrow(
      /cambió de estructura/,
    );
  });

  it("avisa de las columnas con rango en vez de fecha", () => {
    const r = interpretarHojaPrecios(hoja({ fechas: ["11-sept-26", "4 al 10 Jun-20"] }));
    expect(r.fechasIlegibles).toBe(1);
    expect(r.advertencias[0]).toMatch(/rangos de semana/);
  });
});

describe("descuento contra Nueva York", () => {
  const precios = [
    { fecha: "2026-09-11", comprador: "luker_bajo_cadmio" as const, precioCopKg: 15650 },
    { fecha: "2026-09-10", comprador: "luker_bajo_cadmio" as const, precioCopKg: 15300 },
    { fecha: "2026-09-09", comprador: "luker_bajo_cadmio" as const, precioCopKg: 15300 },
  ];
  const futuros = new Map([["2026-09-11", 5961], ["2026-09-10", 5962]]);
  const trms = new Map([["2026-09-11", 3101], ["2026-09-10", 3101]]);

  it("convierte COP/kg a USD/TM y saca la distancia a la bolsa", () => {
    const d = calcularDescuentos(precios, futuros, trms);
    expect(d).toHaveLength(2); // el 9 no tiene futuro ni TRM
    const hoy = d.find((x) => x.fecha === "2026-09-11")!;
    // 15.650 COP/kg × 1000 / 3.101 = 5.046 USD/TM sobre un futuro de 5.961
    expect(hoy.precioUsdTm).toBeCloseTo(5046.8, 1);
    expect(hoy.descuento).toBeCloseTo(-0.15337, 4);
  });

  it("omite los días sin bolsa o sin TRM en vez de interpolarlos", () => {
    // Interpolar produciría descuentos que nadie observó, y todo esto
    // existe justamente para sustituir suposiciones por mediciones.
    expect(calcularDescuentos(precios, futuros, trms).map((d) => d.fecha)).toEqual([
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("resume el actual y el rango, que son decisiones distintas", () => {
    const r = resumirDescuento(calcularDescuentos(precios, futuros, trms), "luker_bajo_cadmio")!;
    expect(r.dias).toBe(2);
    // El actual es el del día más reciente, no el promedio.
    expect(r.fechaActual).toBe("2026-09-11");
    expect(r.actual).toBeCloseTo(-0.15337, 4);
    expect(r.minimo).toBeLessThanOrEqual(r.maximo);
  });

  it("devuelve null para un comprador sin datos", () => {
    expect(resumirDescuento([], "nacional_ibague")).toBeNull();
  });
});

describe("fechas repetidas en la hoja", () => {
  /**
   * La hoja registra un cambio de precio intrasemanal añadiendo otra
   * columna con la misma fecha, a veces con otro precio. Salió en
   * producción: el upsert reventaba con «ON CONFLICT DO UPDATE command
   * cannot affect row a second time», porque el lote traía la misma
   * clave dos veces.
   */
  const conRepetida = () => {
    const filas = Array.from({ length: 13 }, () => ["", "", ""]);
    filas[8] = ["FECHA", "30-jul-26", "30-jul-26"];
    filas[9] = ["Bajo Cadmio", "$13.850", "$13.500"];
    filas[10] = ["Alto Cadmio", "$13.550", "$13.200"];
    filas[11] = ["Más $500 premium", "$13.800", "$13.400"];
    filas[12] = ["Más $500 premium", "$13.750", "$13.350"];
    return filas.map((f) => f.join(",")).join("\n");
  };

  it("deja una sola fila por fecha y comprador", () => {
    const r = interpretarHojaPrecios(conRepetida());
    const luker = r.precios.filter((p) => p.comprador === "luker_bajo_cadmio");
    expect(luker).toHaveLength(1);
  });

  it("conserva la columna de más a la izquierda, que es el apunte reciente", () => {
    const r = interpretarHojaPrecios(conRepetida());
    expect(
      r.precios.find((p) => p.comprador === "luker_bajo_cadmio")?.precioCopKg,
    ).toBe(13850);
  });

  it("avisa en vez de elegir en silencio entre dos precios del mismo día", () => {
    const r = interpretarHojaPrecios(conRepetida());
    expect(r.fechasDuplicadas).toEqual(["2026-07-30"]);
    expect(r.advertencias.join(" ")).toMatch(/más de una columna/);
  });
});
