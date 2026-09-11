import { describe, expect, it } from "vitest";

import {
  comisionesUsd,
  construirEstrategias,
  curvaPayoff,
  evaluarEnEscenario,
  precioMedioEscalonado,
  resultadoCoberturaUsd,
  resumirEstrategia,
} from "../estrategias";
import { construirMatrizEscenarios } from "../escenarios";
import { SUPUESTOS_POR_DEFECTO, type Escenario, type Estrategia, type Lote, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 6000,
  trm: 3100,
  volAnualizada: 0.35,
  volTrmAnualizada: 0.1,
  fechaDatos: "2026-09-11",
};

/** 100 TM calzan exactamente en 10 contratos: aísla el efecto de la cobertura. */
const LOTE: Lote = {
  toneladas: 100,
  costoCopKg: 14_500,
  diasAEmbarque: 90,
  diferencialUsdTm: 250,
  tipoContrato: "por_fijar_ny",
  precioVentaUsdTm: null,
};

const SIN_COMISIONES = { ...SUPUESTOS_POR_DEFECTO, comisionUsdContrato: 0 };

function escenario(futuro: number, trm = 3100, base = 250): Escenario {
  return {
    futuroUsdTm: futuro,
    trm,
    diferencialUsdTm: base,
    etiqueta: "prueba",
    ejes: { precio: 0, trm: 0, base: 0 },
  };
}

const FUTUROS_100: Estrategia = {
  id: "futuros_100",
  tipo: "futuros",
  sentido: "corta",
  nombre: "Venta de futuros 100 %",
  descripcion: "",
  ratioCobertura: 1,
  contratos: 10,
  toneladasCubiertas: 100,
  toneladasResiduales: 0,
  costoInicialUsd: 0,
};

describe("resultadoCoberturaUsd", () => {
  it("el corto en futuros gana cuando el precio cae y pierde cuando sube", () => {
    expect(resultadoCoberturaUsd(FUTUROS_100, 6000, escenario(5000))).toBe(100_000);
    expect(resultadoCoberturaUsd(FUTUROS_100, 6000, escenario(7000))).toBe(-100_000);
    expect(resultadoCoberturaUsd(FUTUROS_100, 6000, escenario(6000))).toBe(0);
  });

  it("sin cobertura el resultado es siempre cero", () => {
    const sin: Estrategia = { ...FUTUROS_100, tipo: "sin_cobertura", contratos: 0, toneladasCubiertas: 0 };
    expect(resultadoCoberturaUsd(sin, 6000, escenario(4000))).toBe(0);
  });

  it("el put solo paga por debajo del strike", () => {
    const put: Estrategia = { ...FUTUROS_100, tipo: "put_protector", strikePut: 5700 };
    expect(resultadoCoberturaUsd(put, 6000, escenario(5000))).toBe(70_000);
    expect(resultadoCoberturaUsd(put, 6000, escenario(6500))).toBe(0);
  });

  it("el collar acota por abajo y cede por arriba", () => {
    const collar: Estrategia = {
      ...FUTUROS_100,
      tipo: "collar",
      strikePut: 5700,
      strikeCall: 6400,
    };
    expect(resultadoCoberturaUsd(collar, 6000, escenario(5000))).toBe(70_000);
    expect(resultadoCoberturaUsd(collar, 6000, escenario(6000))).toBe(0);
    expect(resultadoCoberturaUsd(collar, 6000, escenario(7000))).toBe(-60_000);
  });
});

describe("precioMedioEscalonado", () => {
  it("con un solo tramo equivale a vender todo hoy", () => {
    expect(precioMedioEscalonado(6000, 4000, 1)).toBe(6000);
  });

  it("promedia entre el precio inicial y el final", () => {
    // 4 tramos: peso (4−1)/8 = 0,375
    expect(precioMedioEscalonado(6000, 4000, 4)).toBeCloseTo(6000 - 2000 * 0.375, 9);
  });

  it("tiende a la media simple cuando hay muchos tramos", () => {
    expect(precioMedioEscalonado(6000, 4000, 10_000)).toBeCloseTo(5000, 0);
  });

  it("exige un entero positivo de tramos", () => {
    expect(() => precioMedioEscalonado(6000, 4000, 0)).toThrow();
    expect(() => precioMedioEscalonado(6000, 4000, 2.5)).toThrow();
  });
});

describe("comisionesUsd", () => {
  it("cobra una pata por posición y dos en el collar", () => {
    expect(comisionesUsd(FUTUROS_100, SUPUESTOS_POR_DEFECTO)).toBe(150);
    const collar: Estrategia = { ...FUTUROS_100, tipo: "collar" };
    expect(comisionesUsd(collar, SUPUESTOS_POR_DEFECTO)).toBe(300);
  });
});

describe("cobertura con futuros: qué fija y qué no", () => {
  it("fija el precio del futuro: la utilidad no depende de dónde termine F1", () => {
    const a = evaluarEnEscenario(FUTUROS_100, LOTE, MERCADO, escenario(4200), SIN_COMISIONES);
    const b = evaluarEnEscenario(FUTUROS_100, LOTE, MERCADO, escenario(7800), SIN_COMISIONES);

    expect(a.utilidadCop).toBeCloseTo(b.utilidadCop, 6);
    // El ingreso equivale a vender a F0 + base, sea cual sea F1.
    expect(a.ingresoNetoUsd).toBeCloseTo(100 * (6000 + 250), 6);
  });

  it("NO fija la base: mover el diferencial sí cambia el resultado", () => {
    const conBaseBaja = evaluarEnEscenario(FUTUROS_100, LOTE, MERCADO, escenario(6000, 3100, 150), SIN_COMISIONES);
    const conBaseAlta = evaluarEnEscenario(FUTUROS_100, LOTE, MERCADO, escenario(6000, 3100, 350), SIN_COMISIONES);

    // 200 USD/TM de diferencia de base × 100 TM × TRM 3100
    expect(conBaseAlta.utilidadCop - conBaseBaja.utilidadCop).toBeCloseTo(
      200 * 100 * 3100,
      6,
    );
  });

  it("NO fija la TRM: la revaluación del peso reduce la utilidad", () => {
    const trmAlta = evaluarEnEscenario(FUTUROS_100, LOTE, MERCADO, escenario(6000, 3410), SIN_COMISIONES);
    const trmBaja = evaluarEnEscenario(FUTUROS_100, LOTE, MERCADO, escenario(6000, 2790), SIN_COMISIONES);

    expect(trmAlta.utilidadCop).toBeGreaterThan(trmBaja.utilidadCop);
    expect(trmAlta.ingresoNetoCop - trmBaja.ingresoNetoCop).toBeCloseTo(
      100 * 6250 * (3410 - 2790),
      6,
    );
  });

  it("sin cobertura la utilidad sí sigue al precio del futuro", () => {
    const sin: Estrategia = {
      ...FUTUROS_100,
      id: "sin_cobertura",
      tipo: "sin_cobertura",
      contratos: 0,
      toneladasCubiertas: 0,
      toneladasResiduales: 100,
    };
    const baja = evaluarEnEscenario(sin, LOTE, MERCADO, escenario(4200), SIN_COMISIONES);
    const alta = evaluarEnEscenario(sin, LOTE, MERCADO, escenario(7800), SIN_COMISIONES);

    expect(alta.utilidadCop - baja.utilidadCop).toBeCloseTo(3600 * 100 * 3100, 6);
  });
});

describe("evaluarEnEscenario", () => {
  it("descuenta el costo de adquisición del lote", () => {
    const r = evaluarEnEscenario(FUTUROS_100, LOTE, MERCADO, escenario(6000), SIN_COMISIONES);

    expect(r.costoAdquisicionCop).toBe(100 * 14_500 * 1000);
    expect(r.utilidadCop).toBeCloseTo(r.ingresoNetoCop - r.costoAdquisicionCop, 6);
    expect(r.utilidadCopTm).toBeCloseTo(r.utilidadCop / 100, 6);
  });

  it("convierte las primas a la TRM de hoy y el resto a la del escenario", () => {
    const conPrima: Estrategia = {
      ...FUTUROS_100,
      tipo: "put_protector",
      strikePut: 5000,
      costoInicialUsd: 10_000,
    };
    // Escenario con TRM distinta de la vigente: la prima no debe moverse.
    const r = evaluarEnEscenario(conPrima, LOTE, MERCADO, escenario(6000, 3410), SIN_COMISIONES);
    const ingresoFisicoCop = 100 * 6250 * 3410;

    expect(r.ingresoNetoCop).toBeCloseTo(ingresoFisicoCop - 10_000 * 3100, 6);
  });
});

describe("resumirEstrategia", () => {
  const escenarios = construirMatrizEscenarios(MERCADO, LOTE.diferencialUsdTm);

  it("identifica peor caso, mejor caso y caso base", () => {
    const resumen = resumirEstrategia(FUTUROS_100, LOTE, MERCADO, escenarios, SUPUESTOS_POR_DEFECTO);

    expect(resumen.resultados).toHaveLength(63);
    expect(resumen.peorCaso.utilidadCop).toBeLessThanOrEqual(resumen.casoBase.utilidadCop);
    expect(resumen.mejorCaso.utilidadCop).toBeGreaterThanOrEqual(resumen.casoBase.utilidadCop);
    expect(resumen.rangoUtilidadCop).toBeCloseTo(
      resumen.mejorCaso.utilidadCop - resumen.peorCaso.utilidadCop,
      6,
    );
    expect(resumen.casoBase.escenario.ejes).toEqual({ precio: 0, trm: 0, base: 0 });
  });

  it("la cobertura estrecha el rango de resultados frente a no cubrirse", () => {
    const estrategias = construirEstrategias(LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    const sin = estrategias.find((e) => e.tipo === "sin_cobertura")!;
    const conFuturos = estrategias.find((e) => e.id === "futuros_100")!;

    const rangoSin = resumirEstrategia(sin, LOTE, MERCADO, escenarios, SUPUESTOS_POR_DEFECTO).rangoUtilidadCop;
    const rangoCon = resumirEstrategia(conFuturos, LOTE, MERCADO, escenarios, SUPUESTOS_POR_DEFECTO).rangoUtilidadCop;

    expect(rangoCon).toBeLessThan(rangoSin);
  });

  it("exige al menos un escenario", () => {
    expect(() => resumirEstrategia(FUTUROS_100, LOTE, MERCADO, [], SUPUESTOS_POR_DEFECTO)).toThrow();
  });
});

describe("construirEstrategias", () => {
  const estrategias = construirEstrategias(LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);

  it("cubre las cinco familias que exige el análisis", () => {
    const tipos = new Set(estrategias.map((e) => e.tipo));
    expect(tipos).toEqual(
      new Set(["sin_cobertura", "futuros", "put_protector", "collar", "escalonada"]),
    );
  });

  it("empieza por el caso sin cobertura como referencia", () => {
    expect(estrategias[0].tipo).toBe("sin_cobertura");
    expect(estrategias[0].contratos).toBe(0);
  });

  it("ofrece los tres ratios de futuros con los contratos correctos", () => {
    expect(estrategias.find((e) => e.id === "futuros_50")?.contratos).toBe(5);
    // 75 TM son 7,5 contratos exactos: el empate se rompe subcubriendo.
    expect(estrategias.find((e) => e.id === "futuros_75")?.contratos).toBe(7);
    expect(estrategias.find((e) => e.id === "futuros_100")?.contratos).toBe(10);
  });

  it("los puts llevan strike, prima y costo inicial coherentes", () => {
    const puts = estrategias.filter((e) => e.tipo === "put_protector");
    expect(puts).toHaveLength(3);

    for (const put of puts) {
      expect(put.strikePut).toBeGreaterThan(0);
      expect(put.primaNetaUsdTm).toBeGreaterThan(0);
      expect(put.costoInicialUsd).toBeCloseTo(put.primaNetaUsdTm! * put.toneladasCubiertas, 6);
    }

    // Un piso más alto cuesta más prima.
    const ordenados = [...puts].sort((a, b) => a.strikePut! - b.strikePut!);
    expect(ordenados[2].primaNetaUsdTm!).toBeGreaterThan(ordenados[0].primaNetaUsdTm!);
  });

  it("el collar deja el techo por encima del piso y casi sin costo", () => {
    const collar = estrategias.find((e) => e.tipo === "collar")!;
    expect(collar.strikeCall!).toBeGreaterThan(collar.strikePut!);
    expect(Math.abs(collar.costoInicialUsd)).toBeLessThan(
      estrategias.find((e) => e.id === "put_95")!.costoInicialUsd,
    );
  });
});

describe("curvaPayoff", () => {
  const estrategias = construirEstrategias(LOTE, MERCADO, SIN_COMISIONES);
  const sin = estrategias.find((e) => e.tipo === "sin_cobertura")!;
  const futuros = estrategias.find((e) => e.id === "futuros_100")!;
  const put = estrategias.find((e) => e.id === "put_90")!;

  it("devuelve el número de puntos pedido en orden creciente", () => {
    const curva = curvaPayoff(sin, LOTE, MERCADO, SIN_COMISIONES, { puntos: 21 });

    expect(curva).toHaveLength(21);
    expect(curva[0].futuro).toBeLessThan(curva.at(-1)!.futuro);
    expect(curva.every((p) => Number.isFinite(p.utilidad))).toBe(true);
  });

  it("sin cobertura la curva es una diagonal de pendiente constante", () => {
    const curva = curvaPayoff(sin, LOTE, MERCADO, SIN_COMISIONES, { puntos: 5 });
    const pendientes = curva
      .slice(1)
      .map((p, i) => (p.utilidad - curva[i].utilidad) / (p.futuro - curva[i].futuro));

    for (const pendiente of pendientes) {
      expect(pendiente).toBeCloseTo(pendientes[0], 6);
      // 100 TM expuestas, convertidas a la TRM del escenario.
      expect(pendiente).toBeCloseTo(100 * 3100, 6);
    }
  });

  it("con cobertura total la curva es plana", () => {
    const curva = curvaPayoff(futuros, LOTE, MERCADO, SIN_COMISIONES, { puntos: 9 });
    for (const punto of curva) {
      expect(punto.utilidad).toBeCloseTo(curva[0].utilidad, 6);
    }
  });

  it("el put hace una rodilla: plano por debajo del strike y creciente por encima", () => {
    const curva = curvaPayoff(put, LOTE, MERCADO, SIN_COMISIONES, {
      desde: 4000, hasta: 8000, puntos: 41,
    });
    const strike = put.strikePut!;

    const bajo = curva.filter((p) => p.futuro < strike - 100);
    const alto = curva.filter((p) => p.futuro > strike + 100);

    // Por debajo del strike el put compensa la caída: resultado plano.
    for (const punto of bajo) {
      expect(punto.utilidad).toBeCloseTo(bajo[0].utilidad, 4);
    }
    // Por encima la protección no estorba y la subida se aprovecha.
    expect(alto.at(-1)!.utilidad).toBeGreaterThan(alto[0].utilidad);
  });

  it("rechaza una curva de menos de dos puntos", () => {
    expect(() => curvaPayoff(sin, LOTE, MERCADO, SIN_COMISIONES, { puntos: 1 })).toThrow();
  });
});
