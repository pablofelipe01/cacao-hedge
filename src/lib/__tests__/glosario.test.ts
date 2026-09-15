/**
 * El glosario es la fuente única de las explicaciones.
 *
 * Lo consumen dos superficies: el popup que sale al tocar una cifra y la
 * página `/guia/resultados`. Estas pruebas no comprueban la redacción,
 * comprueban que no puedan separarse ni quedar huérfanas.
 */
import { describe, expect, it } from "vitest";

import { GLOSARIO, SECCIONES_GLOSARIO, type ClaveGlosario } from "../glosario";

describe("glosario", () => {
  it("toda entrada aparece en alguna sección de la guía", () => {
    // Una entrada fuera de las secciones existe en el popup pero es
    // invisible en la guía: media documentación, sin que nadie lo note.
    const enSecciones = new Set(SECCIONES_GLOSARIO.flatMap((s) => s.claves));
    const huerfanas = (Object.keys(GLOSARIO) as ClaveGlosario[]).filter(
      (c) => !enSecciones.has(c),
    );
    expect(huerfanas).toEqual([]);
  });

  it("ninguna sección apunta a una clave que no existe", () => {
    for (const seccion of SECCIONES_GLOSARIO) {
      for (const clave of seccion.claves) {
        expect(GLOSARIO[clave], `${seccion.seccion} → ${clave}`).toBeDefined();
      }
    }
  });

  it("ninguna clave se repite en dos secciones", () => {
    const todas = SECCIONES_GLOSARIO.flatMap((s) => s.claves);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it("toda entrada tiene título y definición no vacíos", () => {
    for (const [clave, e] of Object.entries(GLOSARIO)) {
      expect(e.titulo.trim().length, clave).toBeGreaterThan(0);
      expect(e.que.trim().length, clave).toBeGreaterThan(20);
    }
  });
});
