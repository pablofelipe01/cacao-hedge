/**
 * «Aplicar este escenario»: de un recálculo del chat a un análisis guardado.
 *
 * La propiedad que importa es que el análisis guardado dé EXACTAMENTE las
 * cifras que el analista acababa de citar. Para eso, la fila que se guarda
 * tiene que reconstruirse en el mismo lote que el recálculo usó.
 */
import { describe, expect, it } from "vitest";

import { aplicarCambios, ejecutarRecalculo } from "../analista";
import {
  contextoDesdeFila,
  entradasConCambios,
  validarCambios,
  type EntradasGuardadas,
} from "../contexto-analisis";
import { analizarCobertura } from "@/lib/engine/index";
import { SUPUESTOS_POR_DEFECTO } from "@/lib/engine/tipos";
import type { Json } from "@/types/database";

/** Una fila como la guarda el formulario: venta cerrada, descuento en %. */
const ENTRADAS: EntradasGuardadas = {
  toneladas: 40,
  costoCopKg: 0,
  diasAEmbarque: 90,
  diferencialUsdTm: -23.5,
  modoDiferencial: "porcentual",
  tipoContrato: "precio_fijo_usd",
  precioVentaUsdTm: "6500",
  fechaEmbarque: "2026-12-10",
  situacion: "ya_vendi",
};

const MERCADO = {
  futuroUsdTm: 5961,
  trm: 3101,
  volAnualizada: 0.533,
  volTrmAnualizada: 0.124,
  fechaDatos: "2026-09-11",
  procedencia: { cacao: { fuente: "barchart_csv", simbolo: "CCZ26", barras: 426 } },
};

const FILA = {
  entradas: ENTRADAS as unknown as Json,
  mercado: MERCADO as unknown as Json,
  supuestos: SUPUESTOS_POR_DEFECTO as unknown as Json,
  resultados: { operacion: "venta_sin_comprar" } as unknown as Json,
};

const ESCENARIO = { descripcion: "prueba", origenId: "abc", cambios: {} };

describe("validarCambios", () => {
  it("deja pasar solo las claves que el recálculo conoce", () => {
    expect(validarCambios({ toneladas: 30, descripcion: "x", user_id: 5 })).toEqual({
      toneladas: 30,
    });
  });

  it("rechaza valores que no son números finitos o que no son plausibles", () => {
    expect(validarCambios({ toneladas: "30" })).toBeNull();
    expect(validarCambios({ toneladas: Number.NaN })).toBeNull();
    expect(validarCambios({ toneladas: 0 })).toBeNull();
    expect(validarCambios({ diasAEmbarque: 5000 })).toBeNull();
    expect(validarCambios({ diferencialPorcentaje: -120 })).toBeNull();
  });

  it("rechaza lo que no es un objeto", () => {
    expect(validarCambios(null)).toBeNull();
    expect(validarCambios([1, 2])).toBeNull();
    expect(validarCambios("toneladas")).toBeNull();
  });
});

describe("entradasConCambios", () => {
  it("guarda el porcentaje en el mismo formato que el formulario", () => {
    const e = entradasConCambios(ENTRADAS, { diferencialPorcentaje: -20 }, ESCENARIO);
    expect(e.modoDiferencial).toBe("porcentual");
    expect(e.diferencialUsdTm).toBe(-20);
  });

  it("un diferencial en USD/TM cambia el modo a absoluto", () => {
    const e = entradasConCambios(ENTRADAS, { diferencialUsdTm: -300 }, ESCENARIO);
    expect(e.modoDiferencial).toBe("absoluto");
    expect(e.diferencialUsdTm).toBe(-300);
  });

  it("corre la fecha lo mismo que los días, para que la cabecera no se contradiga", () => {
    const e = entradasConCambios(ENTRADAS, { diasAEmbarque: 120 }, ESCENARIO);
    expect(e.diasAEmbarque).toBe(120);
    expect(e.fechaEmbarque).toBe("2027-01-09");
  });

  it("marca el origen y no toca lo que no se pidió", () => {
    const e = entradasConCambios(ENTRADAS, { toneladas: 30 }, ESCENARIO);
    expect(e.escenario).toEqual(ESCENARIO);
    expect(e.precioVentaUsdTm).toBe("6500");
    expect(e.fechaEmbarque).toBe(ENTRADAS.fechaEmbarque);
  });
});

describe("el análisis aplicado da las cifras que citó el analista", () => {
  const CASOS: Record<string, number>[] = [
    { toneladas: 30 },
    { diferencialPorcentaje: -20 },
    { diferencialUsdTm: -1500 },
    { diasAEmbarque: 150 },
    { precioVentaUsdTm: 6800 },
  ];

  for (const cambios of CASOS) {
    it(JSON.stringify(cambios), () => {
      const { contexto } = contextoDesdeFila(FILA);
      const citado = ejecutarRecalculo(contexto, { descripcion: "x", ...cambios });

      // Lo que hace la acción: guardar las entradas nuevas, y lo que hará
      // la pantalla al abrirlo: reconstruir el lote desde la fila guardada.
      const guardada = {
        ...FILA,
        entradas: entradasConCambios(ENTRADAS, cambios, ESCENARIO) as unknown as Json,
      };
      const reabierto = contextoDesdeFila(guardada).contexto;
      expect(reabierto.lote).toEqual(aplicarCambios(contexto, cambios).lote);

      const r = analizarCobertura(reabierto.lote, reabierto.mercado, reabierto.supuestos);
      const p5 = Object.fromEntries(
        r.evaluaciones.map((e) => [e.resumen.estrategia.id, Math.round(e.monteCarlo.percentiles.p5)]),
      );
      const p5Citado = Object.fromEntries(
        citado.estrategias.map((e) => [e.id, e.utilidadPercentil5Cop]),
      );
      expect(p5).toEqual(p5Citado);
    });
  }
});
