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

  it("redacta también las estructuras con opciones", () => {
    // Antes se negaba y mandaba al cliente a improvisar con la mesa. Un
    // collar tiene patas, strikes y un orden de ejecución concretos: eso
    // es exactamente lo que no debería quedar a la memoria de nadie.
    const put: Estrategia = { ...futuros("corta"), tipo: "put_protector", strikePut: 5675 };
    expect(admiteTextoDeOrden(put)).toBe(true);
    expect(
      textoOrdenBroker({ ...BASE, estrategia: put, operacion: "inventario_sin_vender" }),
    ).toContain("opciones PUT");
  });

  it("no redacta nada para la estrategia de no cubrirse", () => {
    const nada: Estrategia = { ...futuros("corta", 0), tipo: "sin_cobertura" };
    expect(admiteTextoDeOrden(nada)).toBe(false);
  });
});

describe("red de seguridad del sentido", () => {
  it("se niega a redactar si la operación y la estrategia se contradicen", () => {
    // Una venta pendiente de abastecer exige COMPRAR futuros. Si llega
    // con una estrategia corta, algo se cruzó aguas arriba y redactar el
    // texto pondría al cliente a duplicar su exposición.
    expect(() =>
      textoOrdenBroker({
        ...BASE,
        estrategia: futuros("corta"),
        operacion: "venta_sin_comprar",
      }),
    ).toThrow(/Incoherencia en el sentido/);

    expect(() =>
      textoOrdenBroker({
        ...BASE,
        estrategia: futuros("larga"),
        operacion: "inventario_sin_vender",
      }),
    ).toThrow(/Incoherencia en el sentido/);
  });
});

describe("las toneladas no pueden leerse como miles", () => {
  it("no fuerza decimales en un número redondo", () => {
    const t = textoOrdenBroker({
      ...BASE,
      estrategia: futuros("larga"),
      operacion: "venta_sin_comprar",
    });
    // «40,000 TM» lo lee una mesa como cuarenta mil toneladas.
    expect(t).toContain("venta cerrada de 40 TM");
    expect(t).not.toContain("40,000");
  });

  it("conserva los decimales que sí existen", () => {
    const t = textoOrdenBroker({
      ...BASE,
      toneladas: 15.275,
      estrategia: futuros("corta"),
      operacion: "inventario_sin_vender",
    });
    expect(t).toContain("tengo 15,28 TM de cacao en bodega");
  });
});

// ---------------------------------------------------------------------
// Estructuras con opciones
// ---------------------------------------------------------------------

function opcion(
  tipo: Estrategia["tipo"],
  sentido: "larga" | "corta",
  extra: Partial<Estrategia> = {},
): Estrategia {
  return { ...futuros(sentido, 3), tipo, nombre: `prueba ${tipo}`, ...extra };
}

describe("estructuras con opciones", () => {
  it("un put protector pide COMPRA de puts con su strike", () => {
    const t = textoOrdenBroker({
      ...BASE,
      estrategia: opcion("put_protector", "corta", {
        strikePut: 5675,
        primaNetaUsdTm: 31.66,
        costoInicialUsd: 9498,
        nombre: "Put protector strike 5675",
      }),
      operacion: "inventario_sin_vender",
    });
    expect(t).toContain("COMPRA (BUY) de 3 opciones PUT sobre CCZ26, strike 5.675 USD/TM");
    expect(t).toContain("Prima neta estimada por mi modelo: 31,66 USD/TM a pagar");
    // La prima es teórica: el texto tiene que pedir cotización, no imponerla.
    expect(t).toContain("no una cotización");
    expect(t).toContain("cotícenme la estructura completa");
    // Una estructura con opciones no lleva LIMIT sobre el futuro.
    expect(t).not.toContain("Tipo de orden: LIMIT");
  });

  it("un collar de inventario compra el piso y vende el techo", () => {
    const t = textoOrdenBroker({
      ...BASE,
      estrategia: opcion("collar", "corta", {
        strikePut: 5675,
        strikeCall: 6325,
        primaNetaUsdTm: -0.8,
        costoInicialUsd: -16,
        nombre: "Collar 5675 / 6325",
      }),
      operacion: "inventario_sin_vender",
    });
    expect(t).toContain("2 patas, a ejecutar JUNTAS");
    expect(t).toContain("1. COMPRA (BUY) de 3 opciones PUT sobre CCZ26, strike 5.675 USD/TM");
    expect(t).toContain("2. VENTA (SELL) de 3 opciones CALL sobre CCZ26, strike 6.325 USD/TM");
    // Prima negativa = crédito, y el texto tiene que decirlo así.
    expect(t).toContain("0,80 USD/TM a recibir (crédito)");
    expect(t).toContain("las 2 patas van juntas");
  });

  it("el collar inverso es el espejo exacto: compra el techo, vende el piso", () => {
    const t = textoOrdenBroker({
      ...BASE,
      estrategia: opcion("collar_inverso", "larga", {
        strikePut: 5725,
        strikeCall: 6250,
        primaNetaUsdTm: 0.42,
        costoInicialUsd: 125,
        nombre: "Collar inverso 6250 / 5725",
      }),
      operacion: "venta_sin_comprar",
    });
    expect(t).toContain("1. COMPRA (BUY) de 3 opciones CALL sobre CCZ26, strike 6.250 USD/TM");
    expect(t).toContain("2. VENTA (SELL) de 3 opciones PUT sobre CCZ26, strike 5.725 USD/TM");
  });

  it("pide la serie de opciones que cubra hasta el embarque", () => {
    const t = textoOrdenBroker({
      ...BASE,
      fechaEmbarque: "2026-12-10",
      estrategia: opcion("call_protector", "larga", { strikeCall: 6250 }),
      operacion: "venta_sin_comprar",
    });
    expect(t).toContain("mi compra del físico es el 10 de diciembre de 2026");
    expect(t).toContain("serie de opciones que llegue hasta esa fecha");
  });

  it("la escalonada explica los tramos y avisa si no reparten parejo", () => {
    const impar = textoOrdenBroker({
      ...BASE,
      estrategia: opcion("escalonada", "larga", { tramos: 4, nombre: "Fijación escalonada" }),
      operacion: "venta_sin_comprar",
    });
    expect(impar).toContain("repartirla en 4 tramos");
    expect(impar).toContain("3 contratos en 4 tramos no reparte parejo");

    const parejo = textoOrdenBroker({
      ...BASE,
      estrategia: opcion("escalonada", "larga", { tramos: 4, contratos: 8 }),
      operacion: "venta_sin_comprar",
    });
    expect(parejo).toContain("Serían 2 contrato(s) por tramo");
  });

  it("sigue negándose solo con «sin cobertura»", () => {
    const nada = opcion("sin_cobertura", "corta", { contratos: 0 });
    expect(admiteTextoDeOrden(nada)).toBe(false);
    expect(() =>
      textoOrdenBroker({ ...BASE, estrategia: nada, operacion: "inventario_sin_vender" }),
    ).toThrow(/no requiere ninguna orden/);

    // Y ahora sí redacta lo que antes rechazaba.
    expect(admiteTextoDeOrden(opcion("collar", "corta", { strikePut: 1, strikeCall: 2 }))).toBe(true);
  });
});
