import { describe, expect, it } from "vitest";

import {
  DESVIACION_BASE_POR_DEFECTO,
  construirHistograma,
  opcionesDesdeSupuestos,
  simularMonteCarlo,
} from "../montecarlo";
import { construirEstrategias, evaluarEnEscenario } from "../estrategias";
import { escenarioBase } from "../escenarios";
import { SUPUESTOS_POR_DEFECTO, type Lote, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 6000,
  trm: 3100,
  volAnualizada: 0.35,
  volTrmAnualizada: 0.1,
  fechaDatos: "2026-09-11",
};

const LOTE: Lote = {
  toneladas: 100,
  costoCopKg: 14_500,
  diasAEmbarque: 180,
  diferencialUsdTm: 250,
  tipoContrato: "por_fijar_ny",
  precioVentaUsdTm: null,
};

const ESTRATEGIAS = construirEstrategias(LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
const sinCobertura = ESTRATEGIAS.find((e) => e.tipo === "sin_cobertura")!;
const futuros100 = ESTRATEGIAS.find((e) => e.id === "futuros_100")!;

describe("construirHistograma", () => {
  it("reparte todas las observaciones en los intervalos", () => {
    const datos = Array.from({ length: 1000 }, (_, i) => i);
    const h = construirHistograma(datos, 10);

    expect(h).toHaveLength(10);
    expect(h.reduce((s, b) => s + b.cuenta, 0)).toBe(1000);
    expect(h[0].desde).toBe(0);
    expect(h[9].hasta).toBe(999);
  });

  it("colapsa a un solo intervalo si la muestra es constante", () => {
    const h = construirHistograma([5, 5, 5], 10);
    expect(h).toHaveLength(1);
    expect(h[0].cuenta).toBe(3);
  });

  it("devuelve vacío ante una muestra vacía", () => {
    expect(construirHistograma([], 10)).toEqual([]);
  });
});

describe("simularMonteCarlo", () => {
  const opciones = opcionesDesdeSupuestos(SUPUESTOS_POR_DEFECTO);

  it("es reproducible: la misma semilla da el mismo resultado", () => {
    const a = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    const b = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);

    expect(a.mediaCop).toBe(b.mediaCop);
    expect(a.percentiles).toEqual(b.percentiles);
    expect(a.probabilidadPerdida).toBe(b.probabilidadPerdida);
  });

  it("semillas distintas dan resultados distintos pero cercanos", () => {
    const a = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    const b = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, {
      ...opciones,
      semilla: 999,
    });

    expect(a.mediaCop).not.toBe(b.mediaCop);
    // Con 10.000 trayectorias el error de muestreo debe ser pequeño.
    expect(Math.abs(a.mediaCop - b.mediaCop) / Math.abs(a.mediaCop)).toBeLessThan(0.05);
  });

  it("corre el número de trayectorias pedido", () => {
    const d = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, {
      ...opciones,
      trayectorias: 2000,
    });
    expect(d.trayectorias).toBe(2000);
  });

  it("sin deriva, la utilidad media converge al caso base", () => {
    const d = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    const base = evaluarEnEscenario(
      sinCobertura,
      LOTE,
      MERCADO,
      escenarioBase(MERCADO, LOTE.diferencialUsdTm),
      SUPUESTOS_POR_DEFECTO,
    );

    // Martingala: E[F₁] = F₀ y E[TRM₁] = TRM₀, con correlación cero.
    // Con variables antitéticas el desvío queda por debajo del 1 %.
    const desvioRelativo = Math.abs(d.mediaCop / base.utilidadCop - 1);
    expect(desvioRelativo).toBeLessThan(0.01);
  });

  it("usa variables antitéticas: los choques se compensan por pares", () => {
    // Si cada trayectoria tiene su reflejo, la media de la simulación
    // apenas depende de la semilla. Sin antitéticas, cambiar de semilla
    // movía la media varios millones de pesos.
    const medias = [1, 77, 4242, 20260911].map(
      (semilla) =>
        simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, {
          ...opciones,
          semilla,
        }).mediaCop,
    );

    const dispersion = (Math.max(...medias) - Math.min(...medias)) / Math.min(...medias);
    expect(dispersion).toBeLessThan(0.02);
  });

  it("una estrategia con comisiones no puede tener mayor utilidad media que no hacer nada", () => {
    // Cubrirse con futuros es neutral en valor esperado salvo comisiones.
    // Que salga por encima sería ruido del simulador presentado como señal.
    const abierto = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    const cubierto = simularMonteCarlo(futuros100, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);

    expect(cubierto.mediaCop).toBeLessThanOrEqual(abierto.mediaCop);
  });

  it("los percentiles están ordenados", () => {
    const { percentiles, minimoCop, maximoCop } = simularMonteCarlo(
      sinCobertura,
      LOTE,
      MERCADO,
      SUPUESTOS_POR_DEFECTO,
      opciones,
    );

    expect(minimoCop).toBeLessThanOrEqual(percentiles.p5);
    expect(percentiles.p5).toBeLessThan(percentiles.p25);
    expect(percentiles.p25).toBeLessThan(percentiles.p50);
    expect(percentiles.p50).toBeLessThan(percentiles.p75);
    expect(percentiles.p75).toBeLessThan(percentiles.p95);
    expect(percentiles.p95).toBeLessThanOrEqual(maximoCop);
  });

  it("la cobertura estrecha la distribución y reduce la probabilidad de pérdida", () => {
    const abierto = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    const cubierto = simularMonteCarlo(futuros100, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);

    expect(cubierto.desviacionCop).toBeLessThan(abierto.desviacionCop);
    expect(cubierto.percentiles.p5).toBeGreaterThan(abierto.percentiles.p5);
    expect(cubierto.probabilidadPerdida).toBeLessThanOrEqual(abierto.probabilidadPerdida);
  });

  it("el CVaR es al menos tan severo como el VaR", () => {
    const d = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    expect(d.cvarCop).toBeGreaterThanOrEqual(d.varMonteCarloCop);
  });

  it("cubrirse no elimina la incertidumbre: quedan la base y la TRM", () => {
    const cubierto = simularMonteCarlo(futuros100, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    expect(cubierto.desviacionCop).toBeGreaterThan(0);
    expect(DESVIACION_BASE_POR_DEFECTO).toBeGreaterThan(0);
  });

  it("el histograma conserva el total de trayectorias", () => {
    const d = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, {
      ...opciones,
      trayectorias: 5000,
    });
    expect(d.histograma.reduce((s, b) => s + b.cuenta, 0)).toBe(5000);
  });

  it("la probabilidad de pérdida está entre 0 y 1", () => {
    const d = simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, opciones);
    expect(d.probabilidadPerdida).toBeGreaterThanOrEqual(0);
    expect(d.probabilidadPerdida).toBeLessThanOrEqual(1);
  });

  it("rechaza un número de trayectorias inválido", () => {
    expect(() =>
      simularMonteCarlo(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO, {
        ...opciones,
        trayectorias: 0,
      }),
    ).toThrow(/al menos una trayectoria/);
  });
});
