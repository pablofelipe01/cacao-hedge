import { describe, expect, it } from "vitest";

import {
  analizarPosicion,
  asignarBodega,
  diasEntre,
  factorDiferencial,
  precioConDiferencial,
  primerDiaAviso,
  vencimientoParaEmbarque,
  type PosicionEmpresa,
  type VentaComprometida,
} from "../consolidado";
import { SUPUESTOS_POR_DEFECTO, type Mercado } from "../tipos";

const MERCADO: Mercado = {
  futuroUsdTm: 6000,
  trm: 4000,
  volAnualizada: 0.4,
  volTrmAnualizada: 0.1,
  fechaDatos: "2026-09-23",
};

// Pocas trayectorias: las pruebas miden signos y órdenes de magnitud,
// no el tercer decimal.
const SUPUESTOS = { ...SUPUESTOS_POR_DEFECTO, trayectoriasMc: 4000, comisionUsdContrato: 0 };

function posicion(parcial: Partial<PosicionEmpresa>): PosicionEmpresa {
  return {
    hoy: "2026-09-23",
    inventario: { toneladas: 0, costoCopKg: 20000 },
    ventas: [],
    diferencialCompra: { tipo: "fraccion", valor: -0.23 },
    diferencialVentaLibre: { tipo: "usd_tm", valor: 0 },
    fechaVentaLibre: "2026-12-15",
    ...parcial,
  };
}

function venta(parcial: Partial<VentaComprometida> & Pick<VentaComprometida, "id">): VentaComprometida {
  return {
    comprador: "Cliente",
    toneladas: 50,
    fechaEmbarque: "2026-11-10",
    modalidad: "precio_pactado",
    precioUsdTm: 6500,
    ...parcial,
  };
}

describe("diferenciales", () => {
  it("en porcentaje se aplica sobre el futuro; en USD/TM se suma", () => {
    expect(precioConDiferencial(6000, { tipo: "fraccion", valor: -0.05 })).toBeCloseTo(5700);
    expect(precioConDiferencial(6000, { tipo: "usd_tm", valor: 150 })).toBe(6150);
  });

  it("solo el porcentual cambia cuánto del movimiento de NY se hereda", () => {
    expect(factorDiferencial({ tipo: "fraccion", valor: -0.23 })).toBeCloseTo(0.77);
    expect(factorDiferencial({ tipo: "usd_tm", valor: -300 })).toBe(1);
  });
});

describe("vencimientos", () => {
  it("el primer aviso cae diez días hábiles antes del mes de entrega", () => {
    // 1-dic-2026 es martes: diez hábiles antes es el martes 17 de noviembre.
    expect(primerDiaAviso(2026, 12)).toBe("2026-11-17");
    // 1-mar-2027 es lunes: diez hábiles antes es el lunes 15 de febrero.
    expect(primerDiaAviso(2027, 3)).toBe("2027-02-15");
  });

  it("un embarque va contra el primer vencimiento cuyo aviso aún no ha llegado", () => {
    expect(vencimientoParaEmbarque("2026-10-05").codigo).toBe("Z26");
    expect(vencimientoParaEmbarque("2026-11-15").codigo).toBe("Z26");
    // Pasado el aviso de diciembre ya no se puede seguir en diciembre.
    expect(vencimientoParaEmbarque("2026-11-20").codigo).toBe("H27");
    expect(vencimientoParaEmbarque("2027-02-20").codigo).toBe("K27");
    expect(vencimientoParaEmbarque("2027-02-20").simbolo).toBe("CCK27");
  });

  it("cuenta días sin leer el reloj", () => {
    expect(diasEntre("2026-09-23", "2026-10-23")).toBe(30);
  });
});

describe("asignarBodega", () => {
  it("la bodega abastece primero a la venta que embarca antes", () => {
    const partidas = asignarBodega(
      posicion({
        inventario: { toneladas: 60, costoCopKg: 20000 },
        ventas: [
          venta({ id: "tarde", fechaEmbarque: "2027-01-20", toneladas: 40 }),
          venta({ id: "pronto", fechaEmbarque: "2026-10-20", toneladas: 50 }),
        ],
      }),
    );
    const pronto = partidas.find((p) => p.id === "pronto")!;
    const tarde = partidas.find((p) => p.id === "tarde")!;
    expect(pronto).toMatchObject({ deBodega: 50, porComprar: 0 });
    expect(tarde).toMatchObject({ deBodega: 10, porComprar: 30 });
    expect(partidas.some((p) => p.tipo === "sin_vender")).toBe(false);
  });

  it("lo que sobra de bodega queda como cacao sin vender", () => {
    const partidas = asignarBodega(
      posicion({
        inventario: { toneladas: 80, costoCopKg: 20000 },
        ventas: [venta({ id: "v", toneladas: 50 })],
      }),
    );
    const libre = partidas.find((p) => p.tipo === "sin_vender")!;
    expect(libre.toneladas).toBe(30);
    // Sin vender con diferencial en USD/TM: 30 TM largas, uno a uno.
    expect(libre.exposicionTm).toBe(30);
  });

  it("una venta pactada abastecida con bodega no tiene riesgo de precio", () => {
    const [p] = asignarBodega(
      posicion({
        inventario: { toneladas: 50, costoCopKg: 20000 },
        ventas: [venta({ id: "v", toneladas: 50 })],
      }),
    );
    expect(p.exposicionTm).toBe(0);
  });

  it("una venta pactada sin bodega queda corta en lo que falta comprar", () => {
    const [p] = asignarBodega(posicion({ ventas: [venta({ id: "v", toneladas: 100 })] }));
    // Compra al 23 % por debajo de NY: solo el 77 % del movimiento.
    expect(p.exposicionTm).toBeCloseTo(-77);
  });

  it("una venta por fijar sin bodega solo conserva la diferencia entre los dos diferenciales", () => {
    const [p] = asignarBodega(
      posicion({
        ventas: [
          venta({
            id: "v",
            toneladas: 100,
            modalidad: "por_fijar",
            precioUsdTm: null,
            diferencial: { tipo: "fraccion", valor: -0.05 },
          }),
        ],
      }),
    );
    // Vende al 95 % de NY y compra al 77 %: 18 TM netas largas.
    expect(p.exposicionTm).toBeCloseTo(18);
  });
});

describe("analizarPosicion", () => {
  it("agrupa por mes y cubre cada mes en el sentido contrario a su exposición", () => {
    const r = analizarPosicion(
      posicion({
        inventario: { toneladas: 100, costoCopKg: 20000 },
        ventas: [
          venta({ id: "a", fechaEmbarque: "2026-10-15", toneladas: 100 }),
          venta({ id: "b", fechaEmbarque: "2027-01-15", toneladas: 100 }),
        ],
      }),
      MERCADO,
      SUPUESTOS,
    );

    expect(r.meses.map((m) => m.clave)).toEqual(["2026-10", "2027-01"]);
    const [octubre, enero] = r.meses;

    // Octubre sale de bodega a precio pactado: nada que cubrir.
    expect(octubre.exposicionTm).toBe(0);
    expect(octubre.cobertura).toBeNull();

    // Enero hay que comprarlo: comprar futuros de marzo.
    expect(enero.toneladas.porComprar).toBe(100);
    expect(enero.cobertura).toMatchObject({ sentido: "larga", contratos: 8 });
    expect(enero.cobertura!.vencimiento.codigo).toBe("H27");
    expect(r.ordenes).toEqual([
      expect.objectContaining({ sentido: "larga", contratos: 8 }),
    ]);
  });

  it("cubrirse mejora el mal escenario del mes expuesto", () => {
    const r = analizarPosicion(
      posicion({ ventas: [venta({ id: "v", fechaEmbarque: "2027-03-01", toneladas: 200 })] }),
      MERCADO,
      { ...SUPUESTOS, desviacionBaseFraccion: 0 },
    );
    const [mes] = r.meses;
    expect(mes.cubierto.p5Cop).toBeGreaterThan(mes.sinCubrir.p5Cop);
    expect(mes.cubierto.probabilidadPerdida).toBeLessThan(mes.sinCubrir.probabilidadPerdida);
  });

  it("el riesgo del total no es la suma del de cada mes", () => {
    // Un mes largo y otro corto: sobre la misma trayectoria de precio se
    // compensan, y el mal día del total es mucho menos malo que la suma.
    const r = analizarPosicion(
      posicion({
        inventario: { toneladas: 100, costoCopKg: 20000 },
        ventas: [
          venta({
            id: "fijar",
            fechaEmbarque: "2026-11-25",
            toneladas: 100,
            modalidad: "por_fijar",
            precioUsdTm: null,
            diferencial: { tipo: "usd_tm", valor: 0 },
          }),
          venta({ id: "pactada", fechaEmbarque: "2026-12-05", toneladas: 100 }),
        ],
      }),
      MERCADO,
      { ...SUPUESTOS, desviacionBaseFraccion: 0 },
    );
    expect(r.meses).toHaveLength(2);
    const sumaP5 = r.meses.reduce((a, m) => a + m.sinCubrir.p5Cop, 0);
    const sumaMedias = r.meses.reduce((a, m) => a + m.sinCubrir.mediaCop, 0);
    // La distancia de la media al mal día se reduce a menos de la mitad.
    expect(sumaMedias - r.totales.sinCubrir.p5Cop).toBeLessThan((sumaMedias - sumaP5) / 2);
  });

  it("neta en una sola orden los meses que caen en el mismo vencimiento", () => {
    const r = analizarPosicion(
      posicion({
        inventario: { toneladas: 100, costoCopKg: 20000 },
        ventas: [
          // Octubre: 100 por fijar desde bodega → largo 100 → vender 10 Z26.
          venta({
            id: "oct",
            fechaEmbarque: "2026-10-10",
            toneladas: 100,
            modalidad: "por_fijar",
            precioUsdTm: null,
            diferencial: { tipo: "usd_tm", valor: 0 },
          }),
          // Noviembre: 100 pactadas por comprar al −23 % → corto 77 → comprar 8 Z26.
          venta({ id: "nov", fechaEmbarque: "2026-11-10", toneladas: 100 }),
        ],
      }),
      MERCADO,
      SUPUESTOS,
    );
    expect(r.meses.map((m) => m.cobertura?.vencimiento.codigo)).toEqual(["Z26", "Z26"]);
    expect(r.ordenes).toEqual([
      expect.objectContaining({ sentido: "corta", contratos: 2 }),
    ]);
    expect(r.totales.margenInicialUsd).toBe(2 * SUPUESTOS.margenInicialUsd);
  });

  it("es reproducible: las mismas entradas dan las mismas cifras", () => {
    const entrada = posicion({ ventas: [venta({ id: "v" })] });
    const a = analizarPosicion(entrada, MERCADO, SUPUESTOS);
    const b = analizarPosicion(entrada, MERCADO, SUPUESTOS);
    expect(a.totales).toEqual(b.totales);
  });

  it("avisa de una venta con fecha ya pasada y de la bodega sin costo", () => {
    const r = analizarPosicion(
      posicion({
        inventario: { toneladas: 10, costoCopKg: null },
        ventas: [venta({ id: "v", fechaEmbarque: "2026-09-01" })],
      }),
      MERCADO,
      SUPUESTOS,
    );
    expect(r.advertencias.join(" ")).toMatch(/fecha de embarque/);
    expect(r.advertencias.join(" ")).toMatch(/no declara el costo/);
  });
});
