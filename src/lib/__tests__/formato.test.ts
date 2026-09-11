import { describe, expect, it } from "vitest";

import { conSigno, cop, copExacto, diasHasta, fechaLegible, porcentaje, toneladas, usdTm } from "../formato";

describe("cop", () => {
  it("usa coma decimal y punto de miles, como se escribe en Colombia", () => {
    expect(cop(656_843_211)).toBe("656,8 M");
    expect(copExacto(656_843_211)).toBe("656.843.211");
  });

  it("distingue millones de miles de millones sin ambigüedad", () => {
    // «MM» se lee como millones en Colombia: usarlo para miles de
    // millones haría leer 2.617 millones como 2,6 millones.
    expect(cop(2_617_400_000)).toBe("2,62 mil M");
    expect(cop(2_617_400)).toBe("2,6 M");
    expect(cop(2_617_400_000)).not.toContain("MM");
  });

  it("nunca colapsa a la misma etiqueta dos magnitudes distintas", () => {
    expect(cop(1_020_000_000)).not.toBe(cop(1_090_000_000));
  });

  it("escala correctamente en cada tramo", () => {
    expect(cop(500)).toBe("500");
    expect(cop(45_000)).toBe("45 k");
    expect(cop(3_500_000)).toBe("3,5 M");
    expect(cop(1_000_000_000)).toBe("1 mil M");
  });

  it("conserva la cifra significativa en miles de millones", () => {
    // Con un solo decimal, 1.986,5 millones se imprimía «2 mil M».
    expect(cop(1_986_500_000)).toBe("1,99 mil M");
    expect(cop(2_617_400_000)).toBe("2,62 mil M");
  });

  it("conserva el signo de las pérdidas", () => {
    expect(cop(-330_800_000)).toBe("-330,8 M");
    expect(cop(-2_500_000_000)).toBe("-2,5 mil M");
    expect(cop(-1_986_500_000)).toBe("-1,99 mil M");
  });
});

describe("porcentaje", () => {
  it("convierte decimales a porcentaje con coma", () => {
    expect(porcentaje(0.108)).toBe("10,8 %");
    expect(porcentaje(0)).toBe("0,0 %");
    expect(porcentaje(1)).toBe("100,0 %");
  });
});

describe("usdTm y toneladas", () => {
  it("formatea precios sin decimales por defecto", () => {
    expect(usdTm(5972)).toBe("5.972");
    expect(usdTm(3101.55, 2)).toBe("3.101,55");
  });

  it("formatea toneladas con hasta tres decimales", () => {
    expect(toneladas(137)).toBe("137");
    expect(toneladas(137.5)).toBe("137,5");
  });
});

describe("fechaLegible", () => {
  it("traduce una fecha ISO al formato español", () => {
    // El español intercala «de»: «10 de dic de 2026», no «10 dic 2026».
    expect(fechaLegible("2026-12-10")).toBe("10 de dic de 2026");
  });

  it("no desplaza el día por zona horaria", () => {
    // Leer la fecha en horario local en vez de UTC restaría un día en
    // Colombia (UTC-5) para cualquier fecha a medianoche.
    expect(fechaLegible("2026-01-01")).toBe("1 de ene de 2026");
    expect(fechaLegible("2026-12-31")).toBe("31 de dic de 2026");
  });

  it("devuelve la cadena original si no es una fecha", () => {
    expect(fechaLegible("no-es-fecha")).toBe("no-es-fecha");
  });
});

describe("diasHasta", () => {
  it("cuenta días calendario desde una fecha de referencia", () => {
    const hoy = new Date("2026-09-11T15:00:00Z");
    expect(diasHasta("2026-12-10", hoy)).toBe(90);
    expect(diasHasta("2026-09-11", hoy)).toBe(0);
    expect(diasHasta("2026-09-10", hoy)).toBe(-1);
  });

  it("ignora la hora del día: cuenta fechas, no instantes", () => {
    const manana = new Date("2026-09-11T23:59:00Z");
    const madrugada = new Date("2026-09-11T00:01:00Z");
    expect(diasHasta("2026-12-10", manana)).toBe(diasHasta("2026-12-10", madrugada));
  });
});

describe("conSigno", () => {
  it("antepone + solo a los positivos", () => {
    expect(conSigno(250, usdTm)).toBe("+250");
    expect(conSigno(-150, usdTm)).toBe("-150");
    expect(conSigno(0, usdTm)).toBe("0");
  });
});
