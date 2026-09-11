import { describe, expect, it } from "vitest";

import {
  analizarMargen,
  calcularExposicion,
  deltaCoberturaTm,
  varParametrico,
} from "../riesgo";
import { construirEstrategias } from "../estrategias";
import { construirMatrizEscenarios } from "../escenarios";
import { factorZ } from "../numerico";
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
  diasAEmbarque: 365,
  diferencialUsdTm: 250,
  tipoContrato: "por_fijar_ny",
  precioVentaUsdTm: null,
};

const ESTRATEGIAS = construirEstrategias(LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
const sinCobertura = ESTRATEGIAS.find((e) => e.tipo === "sin_cobertura")!;
const futuros100 = ESTRATEGIAS.find((e) => e.id === "futuros_100")!;
const futuros50 = ESTRATEGIAS.find((e) => e.id === "futuros_50")!;
const put90 = ESTRATEGIAS.find((e) => e.id === "put_90")!;
const collar = ESTRATEGIAS.find((e) => e.tipo === "collar")!;

describe("deltaCoberturaTm", () => {
  it("sin cobertura el delta es cero", () => {
    expect(deltaCoberturaTm(sinCobertura, MERCADO, SUPUESTOS_POR_DEFECTO, 365)).toBe(0);
  });

  it("el futuro vendido tiene delta −1 por tonelada cubierta", () => {
    expect(deltaCoberturaTm(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, 365)).toBe(-100);
    expect(deltaCoberturaTm(futuros50, MERCADO, SUPUESTOS_POR_DEFECTO, 365)).toBe(-50);
  });

  it("el put cubre menos que su nominal porque su delta es fraccionario", () => {
    const delta = deltaCoberturaTm(put90, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    expect(delta).toBeLessThan(0);
    expect(delta).toBeGreaterThan(-100);
  });

  it("la escalonada solo tiene fijada una parte del tramo", () => {
    const escalonada = ESTRATEGIAS.find((e) => e.tipo === "escalonada")!;
    const delta = deltaCoberturaTm(escalonada, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    // 4 tramos: queda vivo (1 − 0,375) = 62,5 % de la cobertura.
    expect(delta).toBeCloseTo(-100 * 0.625, 9);
  });

  it("el collar cubre más que el put solo, por la pata vendida", () => {
    const deltaPut = deltaCoberturaTm(put90, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    const deltaCollar = deltaCoberturaTm(collar, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    expect(deltaCollar).toBeLessThan(deltaPut);
  });
});

describe("calcularExposicion", () => {
  it("el nominal es el inventario valorado al futuro vigente", () => {
    const e = calcularExposicion(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.nominalUsd).toBe(600_000);
    expect(e.nominalCop).toBe(600_000 * 3100);
  });

  it("sin cobertura toda la tonelada está expuesta al precio", () => {
    const e = calcularExposicion(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.toneladasExpuestas).toBe(100);
  });

  it("la cobertura total anula la exposición al precio", () => {
    const e = calcularExposicion(futuros100, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.toneladasExpuestas).toBe(0);
    expect(e.exposicionPrecioUsd).toBe(0);
  });

  it("la cobertura al 50 % deja viva la mitad", () => {
    const e = calcularExposicion(futuros50, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.toneladasExpuestas).toBe(50);
  });

  it("la exposición cambiaria no desaparece al cubrir el precio", () => {
    const e = calcularExposicion(futuros100, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    // Todo el ingreso sigue siendo en dólares: 100 TM × (6000 + 250)
    expect(e.exposicionFxUsd).toBe(625_000);
  });

  it("con contrato a precio fijo no hay exposición al futuro", () => {
    const lotePrecioFijo: Lote = {
      ...LOTE,
      tipoContrato: "precio_fijo_usd",
      precioVentaUsdTm: 6400,
    };
    const e = calcularExposicion(sinCobertura, lotePrecioFijo, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.toneladasExpuestas).toBe(0);
    expect(e.exposicionFxUsd).toBe(640_000);
  });
});

describe("varParametrico", () => {
  const exposicionAbierta = calcularExposicion(sinCobertura, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);

  it("reproduce la fórmula delta-normal a un año", () => {
    const r = varParametrico(exposicionAbierta, MERCADO, SUPUESTOS_POR_DEFECTO, 365);

    const aportePrecio = 100 * 6000 * 3100 * 0.35;
    const aporteFx = 625_000 * 3100 * 0.1;
    const esperado = factorZ(0.95) * Math.sqrt(aportePrecio ** 2 + aporteFx ** 2);

    expect(r.aniosHorizonte).toBe(1);
    expect(r.z).toBeCloseTo(1.6449, 4);
    expect(r.varCop).toBeCloseTo(esperado, 2);
  });

  it("escala con la raíz del tiempo", () => {
    const unAnio = varParametrico(exposicionAbierta, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    const trimestre = varParametrico(exposicionAbierta, MERCADO, SUPUESTOS_POR_DEFECTO, 365 / 4);
    expect(trimestre.varCop).toBeCloseTo(unAnio.varCop / 2, 2);
  });

  it("crece con el nivel de confianza", () => {
    const v95 = varParametrico(exposicionAbierta, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    const v99 = varParametrico(
      exposicionAbierta,
      MERCADO,
      { ...SUPUESTOS_POR_DEFECTO, nivelConfianzaVar: 0.99 },
      365,
    );
    expect(v99.varCop).toBeGreaterThan(v95.varCop);
  });

  it("cubrirse reduce el VaR pero no lo lleva a cero: queda el riesgo cambiario", () => {
    const cubierta = calcularExposicion(futuros100, LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    const vCubierto = varParametrico(cubierta, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    const vAbierto = varParametrico(exposicionAbierta, MERCADO, SUPUESTOS_POR_DEFECTO, 365);

    expect(vCubierto.varCop).toBeLessThan(vAbierto.varCop);
    expect(vCubierto.varCop).toBeGreaterThan(0);
    expect(vCubierto.aporteCop.precio).toBe(0);
    expect(vCubierto.aporteCop.tasaCambio).toBeGreaterThan(0);
  });

  it("la correlación positiva entre precio y TRM aumenta el VaR", () => {
    const sinCorr = varParametrico(exposicionAbierta, MERCADO, SUPUESTOS_POR_DEFECTO, 365);
    const conCorr = varParametrico(
      exposicionAbierta,
      MERCADO,
      { ...SUPUESTOS_POR_DEFECTO, correlacionPrecioTrm: 0.5 },
      365,
    );
    expect(conCorr.varCop).toBeGreaterThan(sinCorr.varCop);
  });
});

describe("analizarMargen", () => {
  const escenarios = construirMatrizEscenarios(MERCADO, 250);

  it("no aplica a estrategias sin futuros vendidos", () => {
    expect(analizarMargen(sinCobertura, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)).toBeNull();
    expect(analizarMargen(put90, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)).toBeNull();
    expect(analizarMargen(collar, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)).toBeNull();
  });

  it("calcula el capital inmovilizado", () => {
    const m = analizarMargen(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)!;
    expect(m.contratos).toBe(10);
    expect(m.margenInicialTotalUsd).toBe(80_000);
    expect(m.margenInicialTotalCop).toBe(80_000 * 3100);
    expect(m.margenMantenimientoTotalUsd).toBe(72_000);
  });

  it("el disparador es el colchón dividido por las 10 TM del contrato", () => {
    const m = analizarMargen(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)!;
    // Colchón 800 USD/contrato ÷ 10 TM = 80 USD/TM de subida.
    expect(m.colchonPorContratoUsd).toBe(800);
    expect(m.movimientoDisparadorUsdTm).toBe(80);
    expect(m.precioDisparadorUsdTm).toBe(6080);
    expect(m.movimientoDisparadorPorcentaje).toBeCloseTo(80 / 6000, 9);
  });

  it("solo dispara llamada cuando el precio sube más que el colchón", () => {
    const m = analizarMargen(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)!;
    const bajadas = m.porEscenario.filter((l) => l.futuroUsdTm < 6000);
    expect(bajadas.every((l) => !l.hayLlamada && l.montoUsd === 0)).toBe(true);

    // +10 % son 600 USD/TM: 600.000 USD de pérdida contra un colchón de 8.000.
    const subida10 = m.porEscenario.find((l) => Math.abs(l.futuroUsdTm - 6600) < 1e-6)!;
    expect(subida10.hayLlamada).toBe(true);
    expect(subida10.perdidaUsd).toBeCloseTo(600 * 10 * 10, 6);
    expect(subida10.montoUsd).toBeCloseTo(60_000, 6);
  });

  it("reporta la peor llamada de la matriz", () => {
    const m = analizarMargen(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)!;
    // +30 %: 1.800 USD/TM × 10 TM × 10 contratos
    expect(m.peorLlamada?.montoUsd).toBeCloseTo(180_000, 6);
    expect(m.peorLlamada?.montoCop).toBeGreaterThan(0);
  });

  it("no repite niveles de precio: la llamada solo depende del futuro", () => {
    const m = analizarMargen(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)!;
    expect(m.porEscenario).toHaveLength(7);
  });
});
