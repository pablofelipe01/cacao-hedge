/**
 * El eje de base y el choque de base del Monte Carlo.
 *
 * Los dos salían de constantes escritas a ojo: ±100 USD/TM en la matriz y
 * σ = 50 en la simulación. Medido contra 175 días del precio que publican
 * Nacional de Chocolates y Casa Luker, el diferencial tiene una
 * desviación de 3,3 puntos porcentuales del futuro — sobre 5.961 son 197
 * USD/TM, cuatro veces la constante anterior.
 *
 * Importa más de lo que parece: el riesgo de base es exactamente la parte
 * que la cobertura con futuros NO elimina, así que subestimarlo hace
 * parecer que cubrirse resuelve más de lo que resuelve.
 */
import { describe, expect, it } from "vitest";

import { construirMatrizEscenarios, ejeBaseDesdeDesviacion } from "../escenarios";
import { desviacionBaseUsdTm, DESVIACION_BASE_POR_DEFECTO } from "../montecarlo";
import { analizarCobertura } from "../index";
import { SUPUESTOS_POR_DEFECTO, type Lote, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 5961,
  trm: 3101,
  volAnualizada: 0.533,
  volTrmAnualizada: 0.124,
  fechaDatos: "2026-09-11",
};

describe("desviación de la base", () => {
  it("escala con el nivel de precios, no es una cantidad fija", () => {
    // Los mismos 100 USD/TM eran 1,7 % con el cacao a 6.000 y 0,8 % con
    // el cacao a 12.000: por eso el parámetro va en fracción.
    expect(desviacionBaseUsdTm(SUPUESTOS_POR_DEFECTO, 5961)).toBeCloseTo(196.7, 1);
    expect(desviacionBaseUsdTm(SUPUESTOS_POR_DEFECTO, 12000)).toBeCloseTo(396, 0);
  });

  it("cae al respaldo si no hay futuro con el que escalar", () => {
    expect(desviacionBaseUsdTm(SUPUESTOS_POR_DEFECTO, 0)).toBe(DESVIACION_BASE_POR_DEFECTO);
    expect(desviacionBaseUsdTm({ desviacionBaseFraccion: Number.NaN }, 5961)).toBe(
      DESVIACION_BASE_POR_DEFECTO,
    );
  });

  it("los análisis guardados sin el campo no revientan", () => {
    // Los supuestos viajan en jsonb: uno guardado antes de este cambio no
    // trae el campo, y llega como undefined.
    const viejo = { desviacionBaseFraccion: undefined as unknown as number };
    expect(desviacionBaseUsdTm(viejo, 5961)).toBe(DESVIACION_BASE_POR_DEFECTO);
  });
});

describe("eje de base de la matriz", () => {
  it("abre hasta los percentiles 5 y 95 del diferencial", () => {
    // 1,645 σ sobre 196,7 = 324 USD/TM, no los ±100 de antes.
    expect(ejeBaseDesdeDesviacion(196.7)).toEqual([-324, 0, 324]);
  });

  it("colapsa a un solo punto si no hay dispersión", () => {
    expect(ejeBaseDesdeDesviacion(0)).toEqual([0]);
  });

  it("la matriz usa el eje que se le pasa", () => {
    const escenarios = construirMatrizEscenarios(MERCADO, 250, [-324, 0, 324]);
    const bases = [...new Set(escenarios.map((e) => e.diferencialUsdTm))].sort((a, b) => a - b);
    expect(bases).toEqual([-74, 250, 574]);
  });
});

describe("efecto sobre un análisis completo", () => {
  const lote: Lote = {
    toneladas: 15.275,
    costoCopKg: 16468,
    diasAEmbarque: 90,
    diferencialUsdTm: 250,
    tipoContrato: "sin_contrato",
  };

  it("un riesgo de base mayor ensancha la cola aunque el precio esté cubierto", () => {
    const estrecho = analizarCobertura(lote, MERCADO, {
      ...SUPUESTOS_POR_DEFECTO,
      desviacionBaseFraccion: 0.008, // el supuesto viejo, ~50 USD/TM
    });
    const medido = analizarCobertura(lote, MERCADO, SUPUESTOS_POR_DEFECTO);

    const p5De = (r: typeof medido, id: string) =>
      r.evaluaciones.find((e) => e.resumen.estrategia.id === id)!.monteCarlo.percentiles.p5;

    // Con la base bien dimensionada, cubrirse con futuros deja de parecer
    // que elimina casi todo el riesgo: la cola empeora.
    expect(p5De(medido, "futuros_100")).toBeLessThan(p5De(estrecho, "futuros_100"));
  });
});

describe("estrategias que no se pueden ejecutar", () => {
  /**
   * Salió mirando un análisis real de 10 TM con descuento del 23,5 %: la
   * pantalla ofrecía «Compra de futuros 50 %» con cifras idénticas a no
   * cubrirse, y recomendaba una escalonada en 4 tramos con 1 contrato.
   */
  const lote: Lote = {
    toneladas: 10,
    costoCopKg: 0,
    diasAEmbarque: 14,
    diferencialUsdTm: 0,
    diferencialPorcentual: -0.235,
    tipoOperacion: "venta_sin_comprar",
    tipoContrato: "precio_fijo_usd",
    precioVentaUsdTm: 6500,
  };

  it("no ofrece un ratio que redondea a cero contratos", () => {
    // 10 TM × 0,765 × 50 % = 3,83 TM = 0,38 contratos -> 0.
    const r = analizarCobertura(lote, MERCADO, SUPUESTOS_POR_DEFECTO);
    const futuros = r.evaluaciones.filter((e) => e.resumen.estrategia.tipo === "futuros");
    expect(futuros.every((e) => e.resumen.estrategia.contratos > 0)).toBe(true);
    // Y no queda una fila gemela de «sin cobertura».
    expect(futuros.some((e) => e.resumen.estrategia.id === "futuros_50")).toBe(false);
  });

  it("no ofrece una escalonada con menos contratos que tramos", () => {
    // Un contrato no se parte en cuatro: el precio medio que calcula el
    // motor sería inalcanzable, y el bróker no podría ejecutarla.
    const r = analizarCobertura(lote, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(r.evaluaciones.some((e) => e.resumen.estrategia.tipo === "escalonada")).toBe(false);
    expect(r.recomendacion.idEstrategia).not.toMatch(/escalonada/);
  });

  it("sigue ofreciéndola cuando sí reparte", () => {
    const grande = { ...lote, toneladas: 60 };
    const r = analizarCobertura(grande, MERCADO, SUPUESTOS_POR_DEFECTO);
    const esc = r.evaluaciones.find((e) => e.resumen.estrategia.tipo === "escalonada");
    expect(esc).toBeDefined();
    expect(esc!.resumen.estrategia.contratos).toBeGreaterThanOrEqual(4);
  });
});
