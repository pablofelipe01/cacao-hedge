import { describe, expect, it } from "vitest";

import {
  aNumeroColombiano,
  esCifraRastreable,
  extraerNumeros,
  valoresPermitidos,
  verificarCifras,
} from "../verificacion";

const RESUMEN = {
  mercado: { futuroUsdTm: 5961, trm: 3101, volatilidadCacaoPorcentaje: 53.3 },
  estrategias: [
    { nombre: "Sin cobertura", utilidadCasoBaseCop: 652_200_000, probabilidadPerdidaPorcentaje: 17.3 },
    { nombre: "Futuros 100 %", utilidadPercentil5Cop: 390_500_000, varCop: 269_000_000 },
  ],
  supuestos: { nivelConfianzaVarPorcentaje: 95, percentilAdverso: 5 },
  constantes: { toneladasPorContratoCC: 10 },
};

describe("aNumeroColombiano", () => {
  it("interpreta punto de miles y coma decimal", () => {
    expect(aNumeroColombiano("5.961")).toBe(5961);
    expect(aNumeroColombiano("3.101,55")).toBe(3101.55);
    expect(aNumeroColombiano("17,3")).toBe(17.3);
    expect(aNumeroColombiano("652.200.000")).toBe(652_200_000);
  });
});

describe("extraerNumeros", () => {
  it("encuentra las cifras de un texto en español", () => {
    const n = extraerNumeros("El futuro cerró a 5.961 USD/TM con la TRM en 3.101,00.");
    expect(n.map((x) => x.valor)).toEqual([5961, 3101]);
  });

  it("registra los decimales con que se escribió cada cifra", () => {
    const [a, b] = extraerNumeros("17,3 % frente a 17 %");
    expect(a).toMatchObject({ valor: 17.3, decimales: 1 });
    expect(b).toMatchObject({ valor: 17, decimales: 0 });
  });

  it("ignora los años, que son fechas y no cifras del análisis", () => {
    expect(extraerNumeros("El embarque es el 10 de diciembre de 2026.").map((x) => x.valor))
      .toEqual([10]);
  });

  it("conserva el contexto para poder señalar dónde está la cifra", () => {
    const [n] = extraerNumeros("La prima del put asciende a 498 USD por tonelada.");
    expect(n.contexto).toContain("498");
  });
});

describe("valoresPermitidos", () => {
  it("recoge los números de toda la estructura, por anidada que esté", () => {
    const v = valoresPermitidos(RESUMEN);
    expect(v.has(5961)).toBe(true);
    expect(v.has(53.3)).toBe(true);
    expect(v.has(390_500_000)).toBe(true);
    expect(v.has(10)).toBe(true);
  });
});

describe("esCifraRastreable", () => {
  const permitidos = valoresPermitidos(RESUMEN);
  const citar = (texto: string) => extraerNumeros(texto)[0];

  it("acepta la cifra escrita tal cual", () => {
    expect(esCifraRastreable(citar("5.961"), permitidos)).toBe(true);
  });

  it("acepta la misma cifra abreviada en millones", () => {
    // 652.200.000 COP escrito como «652,2 millones».
    expect(esCifraRastreable(citar("652,2"), permitidos)).toBe(true);
    expect(esCifraRastreable(citar("652"), permitidos)).toBe(true);
  });

  it("acepta un valor negativo redactado en positivo", () => {
    const conNegativo = valoresPermitidos({ perdida: -333_000_000 });
    expect(esCifraRastreable(citar("333"), conNegativo)).toBe(true);
  });

  it("acepta el redondeo con el que se escribió", () => {
    expect(esCifraRastreable(citar("53"), permitidos)).toBe(true);
    expect(esCifraRastreable(citar("53,3"), permitidos)).toBe(true);
  });

  it("RECHAZA una cifra que no sale de los datos", () => {
    expect(esCifraRastreable(citar("7.412"), permitidos)).toBe(false);
    expect(esCifraRastreable(citar("41,9"), permitidos)).toBe(false);
  });
});

describe("verificarCifras", () => {
  it("da por limpio un informe que solo usa cifras de los datos", () => {
    const informe = `
      El futuro CC cerró en 5.961 USD/TM con la TRM en 3.101. Sin cobertura,
      la utilidad esperada es de 652,2 millones de COP y la probabilidad de
      pérdida alcanza el 17,3 %. Con cobertura total, el percentil 5 sube a
      390,5 millones y el VaR baja a 269 millones. Cada contrato CC cubre
      10 toneladas.
    `;
    const r = verificarCifras(informe, RESUMEN);

    expect(r.limpio).toBe(true);
    expect(r.sospechosas).toHaveLength(0);
    expect(r.totalCitadas).toBeGreaterThan(5);
  });

  it("DETECTA una cifra inventada entre cifras correctas", () => {
    const informe = `
      El futuro CC cerró en 5.961 USD/TM. La prima del put asciende a
      498 USD/TM, un 8,3 % del subyacente.
    `;
    const r = verificarCifras(informe, RESUMEN);

    expect(r.limpio).toBe(false);
    expect(r.sospechosas.map((s) => s.valor)).toContain(498);
    expect(r.sospechosas.map((s) => s.valor)).toContain(8.3);
  });

  it("cuenta cuántas rastrean y cuántas no", () => {
    const r = verificarCifras("Son 5.961 USD/TM y 9.999 USD/TM.", RESUMEN);
    expect(r.totalCitadas).toBe(2);
    expect(r.rastreables).toBe(1);
    expect(r.sospechosas).toHaveLength(1);
  });

  it("un informe sin cifras es trivialmente limpio", () => {
    const r = verificarCifras("La cobertura reduce la incertidumbre.", RESUMEN);
    expect(r.limpio).toBe(true);
    expect(r.totalCitadas).toBe(0);
  });
});
