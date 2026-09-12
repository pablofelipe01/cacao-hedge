/**
 * El texto que el cliente le copia al bróker.
 *
 * Es la única salida de la herramienta que se convierte en una orden real
 * con dinero detrás, así que lo que se prueba aquí no es el formato sino
 * que el SENTIDO nunca se invierta: una cobertura larga tiene que decir
 * COMPRA y una corta VENTA, sin excepción.
 */
import { describe, expect, it } from "vitest";

import {
  admiteTextoDeOrden,
  describirVencimiento,
  textoOrdenBroker,
} from "../orden";
import type { Estrategia } from "../tipos";

function futuros(sentido: "larga" | "corta", contratos = 3): Estrategia {
  return {
    id: "futuros_100",
    nombre: "futuros",
    tipo: "futuros",
    sentido,
    contratos,
    toneladasCubiertas: contratos * 10,
    toneladasResiduales: 0,
    ratioCobertura: 1,
    costoInicialUsd: 0,
    descripcion: "",
  };
}

const BASE = {
  simbolo: "CCZ26",
  futuroReferenciaUsdTm: 5961,
  toneladas: 40,
};

describe("texto de orden para el bróker", () => {
  it("dice COMPRA en una cobertura larga y VENTA en una corta", () => {
    const larga = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
    });
    expect(larga).toContain("COMPRA (BUY) de 3 contratos");
    expect(larga).not.toContain("VENTA");

    const corta = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("corta"),
      operacion: "inventario_sin_vender",
    });
    expect(corta).toContain("VENTA (SELL) de 3 contratos");
    expect(corta).not.toContain("COMPRA");
  });

  it("traduce el vencimiento y conserva el símbolo", () => {
    expect(describirVencimiento("CCZ26")).toBe("diciembre de 2026 (CCZ26)");
    expect(describirVencimiento("CCK27")).toBe("mayo de 2027 (CCK27)");
    // Lo que no reconoce se deja crudo: mejor un símbolo que un mes inventado.
    expect(describirVencimiento("CC=F")).toBe("CC=F");
    expect(describirVencimiento("CCA26")).toBe("CCA26");
  });

  it("usa el futuro de referencia cuando no se da precio límite", () => {
    const t = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
    });
    expect(t).toContain("LIMIT a 5.961 USD/TM");
  });

  it("marca la cuenta que falta en vez de inventarla", () => {
    const t = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
    });
    expect(t).toContain("Cuenta: [COMPLETAR]");

    const conCuenta = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
      cuenta: "  8891234  ",
    });
    expect(conCuenta).toContain("Cuenta: 8891234");
  });

  it("omite el stop cuando no se pide", () => {
    const sin = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
    });
    expect(sin).not.toContain("Stop:");

    const con = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
      precioStopUsdTm: 5600,
    });
    expect(con).toContain("Stop: 5.600 USD/TM");
  });

  it("avisa de la llamada de margen en la dirección correcta", () => {
    const larga = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
      disparadorMargenUsdTm: 5881,
    });
    // Comprado en futuros: la llamada llega si el precio CAE.
    expect(larga).toContain("baja a 5.881 USD/TM");

    const corta = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("corta"),
      operacion: "inventario_sin_vender",
      disparadorMargenUsdTm: 6041,
    });
    expect(corta).toContain("sube a 6.041 USD/TM");
  });

  it("se niega a redactar órdenes de opciones", () => {
    const put: Estrategia = { ...futuros("corta"), tipo: "put_protector" };
    expect(admiteTextoDeOrden(put)).toBe(false);
    expect(() => textoOrdenBroker({ ...BASE, estrategia: put, operacion: "inventario_sin_vender" }))
      .toThrow(/strike y prima/);
  });

  it("no redacta nada para la estrategia de no cubrirse", () => {
    const nada: Estrategia = { ...futuros("corta", 0), tipo: "sin_cobertura" };
    expect(admiteTextoDeOrden(nada)).toBe(false);
  });
});
