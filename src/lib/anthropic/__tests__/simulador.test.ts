/**
 * El analista del simulador.
 *
 * Lo que se prueba es la frontera entre las dos mitades: el modelo traduce
 * lo que cuenta el exportador a campos, y el motor calcula. Si esa
 * traducción pisara campos que nadie mencionó, o calculara con un caso a
 * medias, las cifras dejarían de ser del caso que el usuario describió.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import {
  entradaDesdeHerramienta,
  entradaPorDefecto,
  responderSimulador,
  resumirCaso,
} from "../simulador";
import { simularCaso } from "@/lib/engine/simulador";
import { SUPUESTOS_POR_DEFECTO, type Mercado } from "@/lib/engine/tipos";
import type { ContextoSimulador } from "@/lib/simulador/contexto";
import { casoDesdeEntrada, type EntradaCaso } from "@/lib/simulador/entrada";

const MERCADO: Mercado = {
  futuroUsdTm: 7800,
  trm: 3900,
  volAnualizada: 0.45,
  volTrmAnualizada: 0.12,
  fechaDatos: "2026-09-29",
};

const CONTEXTO: ContextoSimulador = {
  mercado: MERCADO,
  advertenciasMercado: [],
  supuestos: { ...SUPUESTOS_POR_DEFECTO, trayectoriasMc: 2000 },
  descuentoMediano: -0.225,
};

const POR_DEFECTO = entradaPorDefecto(-0.225);

const EN_PANTALLA: EntradaCaso = {
  comprador: "Comprador X",
  precioVentaUsdTm: 6500,
  entregas: [
    { fecha: "2026-10-30", toneladas: 75 },
    { fecha: "2026-11-14", toneladas: 75 },
  ],
  descuentoCompraPct: -23,
  diasCompraAntes: 10,
  anticipoPct: 50,
  diasAnticipoAntes: 10,
  diasSaldoDespues: 7,
  costosUsdTm: 150,
  capitalCop: 2_000_000_000,
};

describe("entradaDesdeHerramienta", () => {
  it("toma los valores por defecto del descuento medido", () => {
    expect(POR_DEFECTO.descuentoCompraPct).toBe(-22.5);
    expect(POR_DEFECTO.anticipoPct).toBe(50);
  });

  it("arma el caso del cliente desde un calendario", () => {
    const r = entradaDesdeHerramienta(null, POR_DEFECTO, {
      descripcion: "300 TM",
      precioVentaUsdTm: 6500,
      capitalCop: 3_000_000_000,
      calendario: { toneladasTotales: 300, toneladasPorEntrega: 60, primeraEntrega: "2026-10-30", cadaDias: 15 },
    });
    if (!("entrada" in r)) throw new Error(r.errores.join(" "));
    expect(r.entrada.entregas).toHaveLength(5);
    expect(r.entrada.entregas[4].fecha).toBe("2026-12-29");
    expect(r.entrada.descuentoCompraPct).toBe(-22.5);
  });

  it("pide lo que falta en vez de calcular con un caso a medias", () => {
    const r = entradaDesdeHerramienta(null, POR_DEFECTO, { descripcion: "sin capital", precioVentaUsdTm: 6500 });
    expect("errores" in r && r.errores.join(" ")).toMatch(/entregas.*capital/);
  });

  it("sobre un caso en pantalla, cambia solo lo que se le indica", () => {
    // «¿y si el anticipo fuera del 30 %?»
    const r = entradaDesdeHerramienta(EN_PANTALLA, POR_DEFECTO, { descripcion: "30 %", anticipoPct: 30 });
    if (!("entrada" in r)) throw new Error(r.errores.join(" "));
    expect(r.entrada).toEqual({ ...EN_PANTALLA, anticipoPct: 30 });
  });

  it("rechaza valores absurdos con el mensaje del formulario", () => {
    const r = entradaDesdeHerramienta(EN_PANTALLA, POR_DEFECTO, { descripcion: "x", anticipoPct: 150 });
    expect("errores" in r && r.errores.join(" ")).toMatch(/anticipo/i);
  });
});

describe("resumirCaso", () => {
  it("lleva los pesos en millones, como se van a citar", () => {
    const r = simularCaso(casoDesdeEntrada(EN_PANTALLA, "2026-09-29"), MERCADO, CONTEXTO.supuestos);
    const resumen = resumirCaso(EN_PANTALLA, r);
    expect(resumen.caso.capitalMillonesCop).toBe(2000);
    expect(resumen.estrategias).toHaveLength(6);
    expect(resumen.recomendada).toBe(r.recomendado);
  });
});

/** Cliente falso: devuelve las respuestas en orden y guarda las peticiones. */
function clienteFalso(respuestas: Partial<Anthropic.Message>[]) {
  const peticiones: Anthropic.MessageCreateParams[] = [];
  let i = 0;
  const cliente = {
    messages: {
      create: async (p: Anthropic.MessageCreateParams) => {
        peticiones.push(structuredClone(p));
        return { model: "falso", stop_reason: "end_turn", ...respuestas[i++] } as Anthropic.Message;
      },
    },
  } as unknown as Anthropic;
  return { cliente, peticiones };
}

describe("responderSimulador", () => {
  it("arma el caso, lo simula y lo devuelve para cargarlo en el formulario", async () => {
    const { cliente, peticiones } = clienteFalso([
      {
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "simular_caso",
            input: {
              descripcion: "300 TM a 6.500",
              precioVentaUsdTm: 6500,
              capitalCop: 3_000_000_000,
              calendario: { toneladasTotales: 300, toneladasPorEntrega: 60, primeraEntrega: "2026-10-30", cadaDias: 15 },
            },
          } as Anthropic.ToolUseBlock,
        ],
      },
      { content: [{ type: "text", text: "Con un capital de 3.000 millones el caso cabe.", citations: null }] },
    ]);

    const r = await responderSimulador(CONTEXTO, null, [], "Tengo una venta de 300 TM…", "2026-09-29", { cliente });

    expect(r.casos).toHaveLength(1);
    expect(r.casos[0].entrada.entregas).toHaveLength(5);
    expect(r.sospechosas).toEqual([]);

    // Al modelo le vuelve el resultado del motor, no un eco de su pedido.
    const devuelto = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(JSON.parse(String(devuelto[0].content)).estrategias).toHaveLength(6);
  });

  it("marca las cifras que no salen del motor", async () => {
    const { cliente } = clienteFalso([
      { content: [{ type: "text", text: "Eso le deja unos 987 millones de utilidad.", citations: null }] },
    ]);
    const r = await responderSimulador(CONTEXTO, EN_PANTALLA, [], "¿Cuánto gano?", "2026-09-29", { cliente });
    expect(r.sospechosas.map((s) => s.textual)).toContain("987");
  });

  it("si falta un dato, se lo devuelve al modelo como error para que pregunte", async () => {
    const { cliente, peticiones } = clienteFalso([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t1", name: "simular_caso", input: { descripcion: "x", precioVentaUsdTm: 6500 } } as Anthropic.ToolUseBlock,
        ],
      },
      { content: [{ type: "text", text: "¿Cuántas toneladas y con qué capital?", citations: null }] },
    ]);
    const r = await responderSimulador(CONTEXTO, null, [], "Vendo a 6.500", "2026-09-29", { cliente });
    const devuelto = peticiones[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(devuelto[0].is_error).toBe(true);
    expect(r.casos).toEqual([]);
  });
});
