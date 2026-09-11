import { describe, expect, it } from "vitest";

import {
  comisionesUsd,
  construirEstrategias,
  evaluarEnEscenario,
  resultadoCoberturaUsd,
} from "../estrategias";
import { analizarCobertura } from "../index";
import { analizarMargen, calcularExposicion, deltaCoberturaTm } from "../riesgo";
import { construirMatrizEscenarios } from "../escenarios";
import { dimensionarCobertura } from "../contratos";
import { precioMaximoCompraUsdTm } from "../fx";
import { sentidoDe, SUPUESTOS_POR_DEFECTO, type Escenario, type Lote, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 6000,
  trm: 3100,
  volAnualizada: 0.35,
  volTrmAnualizada: 0.1,
  fechaDatos: "2026-09-11",
};

/**
 * Caso A: 100 TM vendidas a 6.500 USD/TM, pendientes de comprar al
 * productor con un diferencial de 250 sobre NY. 100 TM calzan exactamente
 * en 10 contratos, lo que aísla el efecto de la cobertura del descalce.
 */
const VENTA: Lote = {
  tipoOperacion: "venta_sin_comprar",
  toneladas: 100,
  costoCopKg: 0,
  diasAEmbarque: 90,
  diferencialUsdTm: 250,
  tipoContrato: "precio_fijo_usd",
  precioVentaUsdTm: 6500,
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

const ESTRATEGIAS = construirEstrategias(VENTA, MERCADO, SIN_COMISIONES);
const sinCobertura = ESTRATEGIAS.find((e) => e.tipo === "sin_cobertura")!;
const futuros100 = ESTRATEGIAS.find((e) => e.id === "futuros_100")!;

describe("sentidoDe", () => {
  it("cada situación se cubre en el sentido contrario a su riesgo", () => {
    expect(sentidoDe("inventario_sin_vender")).toBe("corta");
    expect(sentidoDe("venta_sin_comprar")).toBe("larga");
  });
});

describe("catálogo del caso largo", () => {
  it("todas las estrategias van en sentido largo", () => {
    expect(ESTRATEGIAS.every((e) => e.sentido === "larga")).toBe(true);
  });

  it("protege con calls, no con puts", () => {
    const tipos = new Set(ESTRATEGIAS.map((e) => e.tipo));
    expect(tipos.has("call_protector")).toBe(true);
    expect(tipos.has("collar_inverso")).toBe(true);
    // Un put protector aquí no protege nada: pondría piso a un precio que
    // al comprador le conviene que baje.
    expect(tipos.has("put_protector")).toBe(false);
    expect(tipos.has("collar")).toBe(false);
  });

  it("habla de comprar futuros, no de venderlos", () => {
    expect(futuros100.nombre).toMatch(/^Compra de futuros/);
  });

  it("los calls protectores están en el dinero o por encima", () => {
    for (const call of ESTRATEGIAS.filter((e) => e.tipo === "call_protector")) {
      expect(call.strikeCall!).toBeGreaterThanOrEqual(MERCADO.futuroUsdTm * 0.99);
    }
  });
});

describe("resultadoCoberturaUsd en sentido largo", () => {
  it("el futuro comprado gana cuando el precio SUBE", () => {
    expect(resultadoCoberturaUsd(futuros100, 6000, escenario(7000))).toBe(100_000);
    expect(resultadoCoberturaUsd(futuros100, 6000, escenario(5000))).toBe(-100_000);
  });

  it("es exactamente el signo contrario a una cobertura corta", () => {
    const corta = { ...futuros100, sentido: "corta" as const };
    for (const precio of [4500, 6000, 7500]) {
      // toBeCloseTo y no toBe: al precio de hoy ambos dan cero, y +0 y −0
      // no son el mismo valor para una comparación estricta.
      expect(resultadoCoberturaUsd(futuros100, 6000, escenario(precio))).toBeCloseTo(
        -resultadoCoberturaUsd(corta, 6000, escenario(precio)),
        9,
      );
    }
  });

  it("el call solo paga por encima del strike", () => {
    const call = ESTRATEGIAS.find((e) => e.tipo === "call_protector")!;
    const strike = call.strikeCall!;
    expect(resultadoCoberturaUsd(call, 6000, escenario(strike + 500))).toBeCloseTo(
      500 * call.toneladasCubiertas,
      6,
    );
    expect(resultadoCoberturaUsd(call, 6000, escenario(strike - 500))).toBe(0);
  });

  it("el collar inverso acota arriba y cede abajo", () => {
    const collar = ESTRATEGIAS.find((e) => e.tipo === "collar_inverso")!;
    const { strikeCall, strikePut, toneladasCubiertas } = collar;
    expect(resultadoCoberturaUsd(collar, 6000, escenario(strikeCall! + 300))).toBeCloseTo(
      300 * toneladasCubiertas,
      6,
    );
    expect(resultadoCoberturaUsd(collar, 6000, escenario(strikePut! - 300))).toBeCloseTo(
      -300 * toneladasCubiertas,
      6,
    );
  });
});

describe("qué fija y qué no la compra de futuros", () => {
  it("fija el costo de la compra: la utilidad no depende de dónde termine F1", () => {
    const barato = evaluarEnEscenario(futuros100, VENTA, MERCADO, escenario(4200), SIN_COMISIONES);
    const caro = evaluarEnEscenario(futuros100, VENTA, MERCADO, escenario(7800), SIN_COMISIONES);

    expect(barato.utilidadCop).toBeCloseTo(caro.utilidadCop, 6);
    // Margen = precio de venta − base − futuro de hoy, por tonelada.
    expect(barato.ingresoNetoUsd).toBeCloseTo(100 * (6500 - 250 - 6000), 6);
  });

  it("sin cobertura la utilidad CAE cuando el precio sube", () => {
    const barato = evaluarEnEscenario(sinCobertura, VENTA, MERCADO, escenario(4200), SIN_COMISIONES);
    const caro = evaluarEnEscenario(sinCobertura, VENTA, MERCADO, escenario(7800), SIN_COMISIONES);

    // Es la diferencia con el inventario: allí subir el precio es bueno.
    expect(caro.utilidadCop).toBeLessThan(barato.utilidadCop);
    expect(barato.utilidadCop - caro.utilidadCop).toBeCloseTo(3600 * 100 * 3100, 6);
  });

  it("NO fija la base: el diferencial que paga al productor sigue vivo", () => {
    const baja = evaluarEnEscenario(futuros100, VENTA, MERCADO, escenario(6000, 3100, 150), SIN_COMISIONES);
    const alta = evaluarEnEscenario(futuros100, VENTA, MERCADO, escenario(6000, 3100, 350), SIN_COMISIONES);

    // Pagar 200 USD/TM más de prima al productor cuesta lo mismo, cubierto o no.
    expect(baja.utilidadCop - alta.utilidadCop).toBeCloseTo(200 * 100 * 3100, 6);
  });

  it("registra el costo del físico, que en este caso sí flota", () => {
    const r = evaluarEnEscenario(futuros100, VENTA, MERCADO, escenario(6500), SIN_COMISIONES);

    expect(r.ingresoFisicoUsd).toBeCloseTo(100 * 6500, 6);
    expect(r.costoFisicoUsd).toBeCloseTo(100 * (6500 + 250), 6);
    // El cacao no está comprado: no hay costo hundido en pesos.
    expect(r.costoAdquisicionCop).toBe(0);
  });
});

describe("exposición y margen del caso largo", () => {
  it("el físico pendiente de comprar es una posición corta", () => {
    const e = calcularExposicion(sinCobertura, VENTA, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.toneladasExpuestas).toBe(-100);
  });

  it("comprar futuros lleva la exposición al precio a cero", () => {
    expect(deltaCoberturaTm(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, 90)).toBe(100);
    const e = calcularExposicion(futuros100, VENTA, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.toneladasExpuestas).toBe(0);
  });

  it("la exposición cambiaria no desaparece al cubrir el precio", () => {
    const e = calcularExposicion(futuros100, VENTA, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(e.exposicionFxUsd).toBe(100 * 6500);
  });

  it("estando largo, la llamada de margen llega cuando el precio BAJA", () => {
    const escenarios = construirMatrizEscenarios(MERCADO, 250);
    const m = analizarMargen(futuros100, MERCADO, SUPUESTOS_POR_DEFECTO, escenarios)!;

    // Colchón de 800 USD por contrato entre 10 TM = 80 USD/TM de caída.
    expect(m.precioDisparadorUsdTm).toBe(6000 - 80);

    const subidas = m.porEscenario.filter((l) => l.futuroUsdTm > 6000);
    expect(subidas.every((l) => !l.hayLlamada)).toBe(true);

    const caida10 = m.porEscenario.find((l) => Math.abs(l.futuroUsdTm - 5400) < 1e-6)!;
    expect(caida10.hayLlamada).toBe(true);
    expect(caida10.perdidaUsd).toBeCloseTo(600 * 10 * 10, 6);
  });
});

describe("precioMaximoCompraUsdTm", () => {
  it("es el espejo del punto de equilibrio del inventario", () => {
    // Vendiendo a 6.500 con una prima de 250 al productor, el futuro no
    // puede pasar de 6.250 sin comerse el margen.
    expect(precioMaximoCompraUsdTm(6500, 250)).toBe(6250);
  });
});

describe("analizarCobertura en el caso largo", () => {
  const analisis = analizarCobertura(VENTA, MERCADO);

  it("evalúa todas las estrategias del catálogo largo", () => {
    expect(analisis.evaluaciones.length).toBe(ESTRATEGIAS.length);
    expect(analisis.evaluaciones.every((e) => e.resumen.estrategia.sentido === "larga")).toBe(true);
  });

  it("cubrirse estrecha el rango frente a no hacer nada", () => {
    const sin = analisis.evaluaciones.find((e) => e.resumen.estrategia.tipo === "sin_cobertura")!;
    const con = analisis.evaluaciones.find((e) => e.resumen.estrategia.id === "futuros_100")!;

    expect(con.resumen.rangoUtilidadCop).toBeLessThan(sin.resumen.rangoUtilidadCop);
    expect(con.monteCarlo.desviacionCop).toBeLessThan(sin.monteCarlo.desviacionCop);
  });

  it("es determinista y serializable", () => {
    const otra = analizarCobertura(VENTA, MERCADO, { trayectoriasMc: 2000 });
    const igual = analizarCobertura(VENTA, MERCADO, { trayectoriasMc: 2000 });
    expect(JSON.stringify(otra)).toBe(JSON.stringify(igual));
    expect(JSON.stringify(otra)).not.toMatch(/NaN|Infinity/);
  });

  it("exige el precio de venta pactado: sin él la operación no existe", () => {
    expect(() =>
      analizarCobertura({ ...VENTA, precioVentaUsdTm: null }, MERCADO),
    ).toThrow(/precio pactado/i);
  });
});

describe("comisiones del collar inverso", () => {
  it("cobra dos patas, igual que el collar normal", () => {
    const collar = ESTRATEGIAS.find((e) => e.tipo === "collar_inverso")!;
    expect(comisionesUsd(collar, SUPUESTOS_POR_DEFECTO)).toBe(collar.contratos * 15 * 2);
  });
});

describe("dimensionamiento · la exposición residual se describe en el sentido correcto", () => {
  it("invierte la dirección del riesgo residual en una cobertura larga", () => {
    // 15,275 TM no caben en un número entero de contratos: siempre queda
    // descalce, y lo que ese descalce significa depende del sentido.
    const corta = dimensionarCobertura(15.275, 1, "corta");
    const larga = dimensionarCobertura(15.275, 1, "larga");

    // El redondeo es idéntico: solo cambia el texto.
    expect(larga.subcobertura.contratos).toBe(corta.subcobertura.contratos);
    expect(larga.sobrecobertura.contratos).toBe(corta.sobrecobertura.contratos);

    expect(corta.subcobertura.exposicionResidual).toContain("baja del precio");
    expect(larga.subcobertura.exposicionResidual).toContain("subida del precio");

    expect(corta.sobrecobertura.exposicionResidual).toContain("neta corta");
    expect(larga.sobrecobertura.exposicionResidual).toContain("neta larga");
    expect(larga.sobrecobertura.exposicionResidual).toContain("compradas sin venta detrás");
  });

  it("mantiene la cobertura corta como valor por defecto", () => {
    expect(dimensionarCobertura(15.275).subcobertura.exposicionResidual).toBe(
      dimensionarCobertura(15.275, 1, "corta").subcobertura.exposicionResidual,
    );
  });
});
