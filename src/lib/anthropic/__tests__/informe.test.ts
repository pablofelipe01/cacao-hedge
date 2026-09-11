import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { ErrorInforme, generarInforme, type ClienteMensajes } from "../informe";
import type { ResumenCuantitativo } from "../resumen";

/** Resumen mínimo con las cifras que citan los informes de prueba. */
const RESUMEN = {
  mercado: { futuroUsdTm: 5961, trm: 3101 },
  estrategias: [{ nombre: "Futuros 100 %", utilidadPercentil5Cop: 390_500_000 }],
  // `percentilAdverso` va en el resumen real por esto mismo: sin él, un
  // informe que diga «el percentil 5» cita una cifra no rastreable.
  supuestos: { nivelConfianzaVarPorcentaje: 95, percentilAdverso: 5 },
} as unknown as ResumenCuantitativo;

function respuesta(
  texto: string,
  extra: Partial<Anthropic.Message> = {},
): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: texto, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 4000, output_tokens: 1200 },
    ...extra,
  } as Anthropic.Message;
}

function clienteQueDevuelve(mensaje: Anthropic.Message): ClienteMensajes {
  return { messages: { create: vi.fn(async () => mensaje) } };
}

function clienteQueFalla(error: unknown): ClienteMensajes {
  return { messages: { create: vi.fn(async () => { throw error; }) } };
}

describe("generarInforme", () => {
  it("devuelve el texto y la metadata de uso", async () => {
    const informe = await generarInforme(RESUMEN, {
      cliente: clienteQueDevuelve(respuesta("El futuro cerró en 5.961 USD/TM.")),
      modelo: "claude-opus-5",
    });

    expect(informe.markdown).toBe("El futuro cerró en 5.961 USD/TM.");
    expect(informe.meta).toMatchObject({
      modelo: "claude-opus-5",
      tokensEntrada: 4000,
      tokensSalida: 1200,
    });
  });

  it("adjunta la verificación de cifras al resultado", async () => {
    const informe = await generarInforme(RESUMEN, {
      cliente: clienteQueDevuelve(respuesta("Cerró en 5.961 y el percentil 5 da 390,5 millones.")),
    });

    expect(informe.meta.verificacion.limpio).toBe(true);
    expect(informe.meta.verificacion.totalCitadas).toBeGreaterThan(1);
  });

  it("marca las cifras que el modelo se inventó, sin bloquear la entrega", async () => {
    const informe = await generarInforme(RESUMEN, {
      cliente: clienteQueDevuelve(respuesta("La prima es de 498 USD/TM.")),
    });

    // El informe se entrega igual: una cifra dudosa no lo invalida entero.
    expect(informe.markdown).toContain("498");
    expect(informe.meta.verificacion.limpio).toBe(false);
    expect(informe.meta.verificacion.sospechosas.map((s) => s.textual)).toContain("498");
  });

  it("envía el prompt de sistema y el resumen en el mensaje", async () => {
    const cliente = clienteQueDevuelve(respuesta("texto"));
    await generarInforme(RESUMEN, { cliente, modelo: "claude-opus-5" });

    const [parametros] = (cliente.messages.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(parametros.system)).toMatch(/NO calcules nada/);
    expect(String(parametros.messages[0].content)).toContain("5961");
    expect(parametros.model).toBe("claude-opus-5");
  });

  it("detecta que el modelo declinó antes de leer el contenido", async () => {
    await expect(
      generarInforme(RESUMEN, {
        cliente: clienteQueDevuelve(respuesta("", { stop_reason: "refusal", content: [] })),
      }),
    ).rejects.toMatchObject({ causa: "rechazo" });
  });

  it("falla con claridad si la respuesta no trae texto", async () => {
    await expect(
      generarInforme(RESUMEN, { cliente: clienteQueDevuelve(respuesta("   ")) }),
    ).rejects.toMatchObject({ causa: "vacio" });
  });

  it("clasifica el rechazo de credenciales como no reintentable", async () => {
    const error = Object.create(Anthropic.AuthenticationError.prototype);
    await expect(
      generarInforme(RESUMEN, { cliente: clienteQueFalla(error) }),
    ).rejects.toMatchObject({ causa: "sin_credenciales", reintentable: false });
  });

  it("clasifica el límite de peticiones como reintentable", async () => {
    const error = Object.create(Anthropic.RateLimitError.prototype);
    await expect(
      generarInforme(RESUMEN, { cliente: clienteQueFalla(error) }),
    ).rejects.toMatchObject({ causa: "limite", reintentable: true });
  });

  it("trata un fallo de red como reintentable", async () => {
    await expect(
      generarInforme(RESUMEN, { cliente: clienteQueFalla(new TypeError("fetch failed")) }),
    ).rejects.toMatchObject({ causa: "api", reintentable: true });
  });

  it("los errores llevan mensaje en español para el usuario", async () => {
    const error = Object.create(Anthropic.AuthenticationError.prototype);
    try {
      await generarInforme(RESUMEN, { cliente: clienteQueFalla(error) });
      expect.unreachable("debía lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorInforme);
      expect((e as ErrorInforme).mensajeUsuario).toMatch(/ANTHROPIC_API_KEY/);
    }
  });

  it("concatena varios bloques de texto de la respuesta", async () => {
    const dosBloques = respuesta("", {
      content: [
        { type: "text", text: "Primera parte. ", citations: null },
        { type: "text", text: "Segunda parte.", citations: null },
      ] as Anthropic.ContentBlock[],
    });

    const informe = await generarInforme(RESUMEN, { cliente: clienteQueDevuelve(dosBloques) });
    expect(informe.markdown).toBe("Primera parte. Segunda parte.");
  });
});
