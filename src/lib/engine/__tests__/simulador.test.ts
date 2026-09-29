import { describe, expect, it } from "vitest";

import { generarEntregas, simularCaso, validarCaso, type CasoHipotetico } from "../simulador";
import { SUPUESTOS_POR_DEFECTO, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 7800,
  trm: 3900,
  volAnualizada: 0.45,
  volTrmAnualizada: 0.12,
  fechaDatos: "2026-09-29",
};

// Pocas trayectorias: las pruebas miden signos y órdenes de magnitud.
const SUPUESTOS = {
  ...SUPUESTOS_POR_DEFECTO,
  trayectoriasMc: 4000,
  margenInicialUsd: 8460,
  margenMantenimientoUsd: 7690,
  comisionUsdContrato: 22,
};

/** Sin volatilidad de nada: el mundo se queda quieto y todo es aritmética. */
const QUIETO: Mercado = { ...MERCADO, volAnualizada: 0, volTrmAnualizada: 0 };
const SIN_BASE = { ...SUPUESTOS, desviacionBaseFraccion: 1e-12, trayectoriasMc: 2 };

/** El caso del cliente: 300 TM a precio fijo en entregas quincenales. */
function caso(parcial: Partial<CasoHipotetico> = {}): CasoHipotetico {
  return {
    hoy: "2026-09-29",
    precioVentaUsdTm: 6500,
    entregas: generarEntregas(300, 60, "2026-10-30", 15),
    diferencialCompra: { tipo: "fraccion", valor: -0.23 },
    diasCompraAntes: 10,
    anticipo: { fraccion: 0.5, diasAntesEntrega: 10 },
    diasSaldoDespues: 7,
    costosUsdTm: 150,
    capitalCop: 3_000_000_000,
    ...parcial,
  };
}

const plan = (r: ReturnType<typeof simularCaso>, id: string) => r.planes.find((p) => p.plan.id === id)!;

describe("generarEntregas", () => {
  it("reparte en entregas iguales cada tantos días", () => {
    const e = generarEntregas(300, 75, "2026-10-30", 15);
    expect(e.map((x) => x.toneladas)).toEqual([75, 75, 75, 75]);
    expect(e.map((x) => x.fecha)).toEqual(["2026-10-30", "2026-11-14", "2026-11-29", "2026-12-14"]);
  });

  it("la última entrega se lleva el resto", () => {
    expect(generarEntregas(300, 70, "2026-10-30", 15).map((x) => x.toneladas)).toEqual([70, 70, 70, 70, 20]);
  });

  it("no genera nada con cantidades vacías", () => {
    expect(generarEntregas(0, 50, "2026-10-30", 15)).toEqual([]);
  });
});

describe("validarCaso", () => {
  it("acepta el caso del cliente", () => {
    expect(validarCaso(caso())).toEqual([]);
  });

  it("explica lo que falta en vez de calcular con basura", () => {
    const errores = validarCaso(caso({ precioVentaUsdTm: 0, entregas: [] }));
    expect(errores.join(" ")).toMatch(/precio de venta/);
    expect(errores.join(" ")).toMatch(/al menos una entrega/);
  });
});

describe("simularCaso — aritmética con el mundo quieto", () => {
  const r = simularCaso(caso(), QUIETO, SIN_BASE);

  it("el margen de hoy es precio de venta menos compra menos logística", () => {
    // 6.500 − 7.800 × 0,77 − 150 = 344 USD/TM.
    expect(r.margenHoyUsdTm).toBeCloseTo(344, 6);
    expect(r.utilidadHoyCop).toBeCloseTo(344 * 300 * 3900, 0);
  });

  it("el equilibrio es el NY al que la venta deja de ganar", () => {
    expect(r.equilibrioUsdTm).toBeCloseTo((6500 - 150) / 0.77, 6);
  });

  it("sin cobertura, la utilidad simulada es exactamente la de hoy", () => {
    expect(plan(r, "sin_cobertura").utilidad.mediaCop).toBeCloseTo(r.utilidadHoyCop, -2);
  });

  it("con futuros, la utilidad es la de hoy menos las comisiones", () => {
    const f = plan(r, "futuros_100");
    // 60 × 0,77 = 46,2 TM de NY por entrega → 5 contratos → 25 en total.
    expect(f.contratos).toBe(25);
    expect(f.utilidad.mediaCop).toBeCloseTo(r.utilidadHoyCop - 25 * 22 * 3900, -2);
  });

  it("el calendario termina donde empezó más la utilidad", () => {
    const sinCobertura = simularCaso(caso(), QUIETO, SIN_BASE, [
      r.planes[0].plan,
    ]);
    const ultimo = sinCobertura.calendario.at(-1)!;
    expect(ultimo.saldoCop).toBeCloseTo(3_000_000_000 + r.utilidadHoyCop, -2);
  });

  it("el punto más bajo de la caja sale del calendario", () => {
    const soloFuturos = simularCaso(caso(), QUIETO, SIN_BASE, [plan(r, "futuros_100").plan]);
    const minimoCalendario = Math.min(...soloFuturos.calendario.map((m) => m.saldoCop));
    // La simulación mira semana a semana y en cada hito, igual que el calendario.
    expect(soloFuturos.planes[0].cajaMinima.mediana).toBeCloseTo(minimoCalendario, -2);
  });
});

describe("simularCaso — riesgo y caja", () => {
  const r = simularCaso(caso(), MERCADO, SUPUESTOS);

  it("los futuros protegen el peor 5 % de una venta fija", () => {
    expect(plan(r, "futuros_100").utilidad.p5Cop).toBeGreaterThan(plan(r, "sin_cobertura").utilidad.p5Cop);
  });

  it("pero exigen más caja que el call", () => {
    expect(plan(r, "futuros_100").cajaMinima.mediana).toBeLessThan(plan(r, "call_atm").cajaMinima.mediana);
    expect(plan(r, "futuros_100").llamadasMargenP95Cop).toBeGreaterThan(0);
  });

  it("las opciones no tienen llamadas de margen", () => {
    expect(plan(r, "call_atm").llamadasMargenP95Cop).toBe(0);
    expect(plan(r, "call_spread").llamadasMargenP95Cop).toBe(0);
  });

  it("el call spread cuesta menos prima que el call", () => {
    expect(plan(r, "call_spread").primaUsd).toBeLessThan(plan(r, "call_atm").primaUsd);
  });

  it("con capital justo no recomienda la cobertura que no cabe", () => {
    // Con 2.500 M los futuros no alcanzan: 825 M de margen inicial y las
    // llamadas si el cacao baja. El call sí: le pone techo a la compra, y
    // con él también a la caja que exige el peor camino.
    const justo = simularCaso(caso({ capitalCop: 2_500_000_000 }), MERCADO, SUPUESTOS);
    const futuros = plan(justo, "futuros_100");
    expect(futuros.cabeEnCapital).toBe(false);
    expect(justo.recomendado).not.toBe("futuros_100");
    expect(justo.planes.find((p) => p.plan.id === justo.recomendado)!.cabeEnCapital).toBe(true);
  });

  it("sin capital que alcance, lo dice en vez de recomendar algo imposible", () => {
    const corto = simularCaso(
      caso({ capitalCop: 0, anticipo: { fraccion: 0, diasAntesEntrega: 0 } }),
      MERCADO,
      SUPUESTOS,
    );
    expect(corto.planes.every((p) => !p.cabeEnCapital)).toBe(true);
    expect(corto.justificacion).toMatch(/ninguna alternativa/i);
    expect(corto.advertencias.join(" ")).toMatch(/caja se queda corta/);
  });

  it("avisa cuando la venta no deja margen ni al precio de hoy", () => {
    const mala = simularCaso(caso({ precioVentaUsdTm: 5000 }), MERCADO, SUPUESTOS);
    expect(mala.advertencias.join(" ")).toMatch(/no deja margen/);
  });

  it("cada entrega se cubre con el vencimiento que sigue abierto al comprar", () => {
    const f = plan(r, "futuros_100");
    // Compra del 20-oct: el diciembre sigue abierto (aviso a mediados de nov).
    expect(f.porEntrega[0].vencimiento.codigo).toBe("Z26");
    // Compra del 19-dic: ya pasó el aviso de diciembre → marzo.
    expect(f.porEntrega[4].vencimiento.codigo).toBe("H27");
  });

  it("es reproducible: misma semilla, mismas cifras", () => {
    const otra = simularCaso(caso(), MERCADO, SUPUESTOS);
    expect(otra.planes.map((p) => p.utilidad.p5Cop)).toEqual(r.planes.map((p) => p.utilidad.p5Cop));
  });
});
