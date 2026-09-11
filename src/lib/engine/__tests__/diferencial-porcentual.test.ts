/**
 * Diferencial pactado como porcentaje del futuro.
 *
 * El exportador compra el físico a un 22–25 % por debajo del cierre de
 * Nueva York del día, no a una cantidad fija en dólares. La diferencia
 * parece de forma y es de fondo: con un descuento porcentual el precio
 * del físico se mueve solo (1 + p) por cada dólar que se mueve la bolsa,
 * así que la exposición real es del 76,5 %, no del 100 %.
 *
 * Cubrir el 100 % de las toneladas en ese caso no es cubrirse de más por
 * prudencia: deja una posición especulativa comprada encima de la
 * cobertura, que gana si el precio sube y pierde si baja.
 */
import { describe, expect, it } from "vitest";

import { analizarCobertura } from "../index";
import { construirEstrategias, evaluarEnEscenario } from "../estrategias";
import {
  diferencialEnEscenarioUsdTm,
  factorExposicion,
  precioFisicoUsdTm,
  precioMaximoCompraUsdTm,
  toneladasExpuestasAlPrecio,
} from "../fx";
import { SUPUESTOS_POR_DEFECTO, type Escenario, type Lote, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 5961,
  trm: 3101,
  volAnualizada: 0.533,
  volTrmAnualizada: 0.124,
  fechaDatos: "2026-09-11",
};

/** 40 TM vendidas en firme, por comprar a un 23,5 % bajo Nueva York. */
const LOTE: Lote = {
  toneladas: 40,
  costoCopKg: 0,
  diasAEmbarque: 90,
  diferencialUsdTm: 0,
  diferencialPorcentual: -0.235,
  tipoOperacion: "venta_sin_comprar",
  tipoContrato: "precio_fijo_usd",
  precioVentaUsdTm: 6500,
};

describe("diferencial porcentual", () => {
  it("el descuento en dólares se abre cuando sube la bolsa", () => {
    expect(diferencialEnEscenarioUsdTm(LOTE, 5961)).toBeCloseTo(-1400.8, 1);
    expect(diferencialEnEscenarioUsdTm(LOTE, 7500)).toBeCloseTo(-1762.5, 1);
    // Un diferencial fijo, en cambio, no se entera de dónde está la bolsa.
    const fijo = { diferencialUsdTm: -1400 };
    expect(diferencialEnEscenarioUsdTm(fijo, 7500)).toBe(-1400);
  });

  it("expone solo el 76,5 % de las toneladas", () => {
    expect(factorExposicion(LOTE)).toBeCloseTo(0.765, 6);
    expect(toneladasExpuestasAlPrecio(LOTE)).toBeCloseTo(30.6, 6);
    expect(precioFisicoUsdTm(LOTE, 5961, diferencialEnEscenarioUsdTm(LOTE, 5961))).toBeCloseTo(
      5961 * 0.765,
      6,
    );
  });

  it("despeja el techo de compra en vez de restarlo", () => {
    // 6.500 / 0,765 = 8.497: la bolsa puede subir mucho más que con un
    // diferencial fijo, porque el costo sube más despacio que ella.
    expect(precioMaximoCompraUsdTm(6500, LOTE)).toBeCloseTo(8496.7, 1);
  });

  it("dimensiona la cobertura sobre la exposición, no sobre el físico", () => {
    const estrategias = construirEstrategias(LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    const total = estrategias.find((e) => e.id === "futuros_100");
    expect(total).toBeDefined();
    // 30,6 TM expuestas = 3,06 contratos -> 3. Con el modelo aditivo
    // habrían sido 4, y esa cuarta posición sería especulación.
    expect(total!.contratos).toBe(3);
  });

  it("con 3 contratos la utilidad queda plana; con 4 se dispara", () => {
    const evaluarEn = (contratos: number, futuro: number) => {
      const estrategia = {
        id: "prueba",
        nombre: "prueba",
        tipo: "futuros" as const,
        sentido: "larga" as const,
        contratos,
        toneladasCubiertas: contratos * 10,
        ratioCobertura: 1,
        toneladasResiduales: 0,
        costoInicialUsd: 0,
        descripcion: "",
      };
      const escenario: Escenario = {
        futuroUsdTm: futuro,
        trm: MERCADO.trm,
        diferencialUsdTm: diferencialEnEscenarioUsdTm(LOTE, futuro),
        etiqueta: "",
        ejes: { precio: 0, trm: 0, base: 0 },
      };
      return evaluarEnEscenario(estrategia, LOTE, MERCADO, escenario, SUPUESTOS_POR_DEFECTO)
        .utilidadCop;
    };

    const rango = (n: number) =>
      Math.abs(evaluarEn(n, 7500) - evaluarEn(n, 4500));

    // Tres contratos dejan un residual pequeño; cuatro dejan al exportador
    // comprado sobre ~9 TM que no tiene por qué tener.
    expect(rango(3)).toBeLessThan(rango(4) / 3);
  });

  it("el análisis completo no rompe con diferencial porcentual", () => {
    const r = analizarCobertura(LOTE, MERCADO, SUPUESTOS_POR_DEFECTO);
    expect(r.operacion).toBe("venta_sin_comprar");
    expect(r.dimensionamiento.contratosExactos).toBeCloseTo(3.06, 2);
    expect(r.precioEquilibrioUsdTm).toBeCloseTo(8496.7, 1);
    expect(r.evaluaciones.length).toBeGreaterThan(0);
  });
});
