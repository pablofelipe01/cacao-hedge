import { describe, expect, it } from "vitest";

import { analizarCobertura, detectarAdvertencias, recomendar } from "../index";
import type { Lote, Mercado } from "../tipos";

/** Mercado del 11-09-2026: CC=F a 5.972 USD/TM y TRM oficial 3.101. */
const MERCADO: Mercado = {
  futuroUsdTm: 5972,
  trm: 3101,
  volAnualizada: 0.35,
  volTrmAnualizada: 0.1,
  fechaDatos: "2026-09-11",
};

const LOTE: Lote = {
  toneladas: 137,
  costoCopKg: 14_500,
  diasAEmbarque: 90,
  diferencialUsdTm: 250,
  tipoContrato: "por_fijar_ny",
  precioVentaUsdTm: null,
};

describe("analizarCobertura", () => {
  const analisis = analizarCobertura(LOTE, MERCADO);

  it("evalúa todas las estrategias del catálogo", () => {
    expect(analisis.evaluaciones.length).toBeGreaterThanOrEqual(9);
    const tipos = new Set(analisis.evaluaciones.map((e) => e.resumen.estrategia.tipo));
    expect(tipos).toEqual(
      new Set(["sin_cobertura", "futuros", "put_protector", "collar", "escalonada"]),
    );
  });

  it("cada evaluación trae resumen, exposición, VaR y Monte Carlo", () => {
    for (const e of analisis.evaluaciones) {
      expect(e.resumen.resultados).toHaveLength(63);
      expect(e.var.varCop).toBeGreaterThan(0);
      expect(e.monteCarlo.trayectorias).toBe(10_000);
      expect(Number.isFinite(e.exposicion.nominalCop)).toBe(true);
    }
  });

  it("solo las estrategias con futuros vendidos tienen análisis de margen", () => {
    for (const e of analisis.evaluaciones) {
      const usaFuturos = ["futuros", "escalonada"].includes(e.resumen.estrategia.tipo);
      expect(e.margen !== null).toBe(usaFuturos);
    }
  });

  it("calcula el horizonte y el punto de equilibrio", () => {
    expect(analisis.aniosHorizonte).toBeCloseTo(90 / 365, 9);
    // 14.500 COP/kg ÷ 3.101 COP/USD × 1000
    expect(analisis.precioEquilibrioUsdTm).toBeCloseTo(4675.91, 1);
  });

  it("dimensiona la cobertura del lote completo", () => {
    expect(analisis.dimensionamiento.contratosExactos).toBeCloseTo(13.7, 9);
    expect(analisis.dimensionamiento.recomendada.contratos).toBe(14);
  });

  it("es determinista: corridas repetidas dan exactamente el mismo resultado", () => {
    // Ambas corridas se hacen dentro del test para que la comparación no
    // dependa de cuándo se evaluó el cuerpo del describe.
    const referencia = JSON.stringify(analizarCobertura(LOTE, MERCADO, { trayectoriasMc: 2000 }));
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(analizarCobertura(LOTE, MERCADO, { trayectoriasMc: 2000 }))).toBe(
        referencia,
      );
    }
  });

  it("produce un resultado serializable para guardar en jsonb", () => {
    const json = JSON.parse(JSON.stringify(analisis));
    expect(json.recomendacion.idEstrategia).toBe(analisis.recomendacion.idEstrategia);
    expect(JSON.stringify(analisis)).not.toMatch(/NaN|Infinity/);
  });

  it("cubrirse reduce la dispersión frente a no hacer nada", () => {
    const sin = analisis.evaluaciones.find((e) => e.resumen.estrategia.tipo === "sin_cobertura")!;
    const con = analisis.evaluaciones.find((e) => e.resumen.estrategia.id === "futuros_100")!;

    expect(con.monteCarlo.desviacionCop).toBeLessThan(sin.monteCarlo.desviacionCop);
    expect(con.resumen.rangoUtilidadCop).toBeLessThan(sin.resumen.rangoUtilidadCop);
  });

  it("acepta supuestos parciales sin perder los valores por defecto", () => {
    const conMenos = analizarCobertura(LOTE, MERCADO, { trayectoriasMc: 500 });
    expect(conMenos.supuestos.trayectoriasMc).toBe(500);
    expect(conMenos.supuestos.margenInicialUsd).toBe(8000);
    expect(conMenos.evaluaciones[0].monteCarlo.trayectorias).toBe(500);
  });
});

describe("recomendar", () => {
  it("elige la estrategia con mejor percentil 5", () => {
    const { evaluaciones, recomendacion } = analizarCobertura(LOTE, MERCADO);
    const mejorP5 = Math.max(...evaluaciones.map((e) => e.monteCarlo.percentiles.p5));
    const elegida = evaluaciones.find((e) => e.resumen.estrategia.id === recomendacion.idEstrategia)!;

    expect(elegida.monteCarlo.percentiles.p5).toBe(mejorP5);
    expect(recomendacion.criterio).toMatch(/percentil 5/i);
    expect(recomendacion.justificacion.length).toBeGreaterThan(20);
  });

  it("falla si no hay nada que comparar", () => {
    expect(() => recomendar([])).toThrow(/comparar/);
  });
});

describe("detectarAdvertencias", () => {
  it("no advierte nada en un lote sano", () => {
    expect(detectarAdvertencias(LOTE, MERCADO)).toEqual([]);
  });

  it("señala que cubrir un contrato a precio fijo sería especular", () => {
    const fijo: Lote = { ...LOTE, tipoContrato: "precio_fijo_usd", precioVentaUsdTm: 6400 };
    expect(detectarAdvertencias(fijo, MERCADO).join(" ")).toMatch(/especulativa/i);
  });

  it("avisa cuando el costo del lote ya supera el precio de venta esperado", () => {
    const caro: Lote = { ...LOTE, costoCopKg: 30_000 };
    expect(detectarAdvertencias(caro, MERCADO).join(" ")).toMatch(/no cubre el costo/i);
  });

  it("avisa de horizontes sin sentido o demasiado largos", () => {
    expect(detectarAdvertencias({ ...LOTE, diasAEmbarque: 0 }, MERCADO).join(" ")).toMatch(/hoy o ya pasó/i);
    expect(detectarAdvertencias({ ...LOTE, diasAEmbarque: 500 }, MERCADO).join(" ")).toMatch(/supera un año/i);
  });

  it("sospecha de un diferencial con unidades equivocadas", () => {
    expect(detectarAdvertencias({ ...LOTE, diferencialUsdTm: 5000 }, MERCADO).join(" ")).toMatch(
      /tonelada métrica/i,
    );
  });
});
