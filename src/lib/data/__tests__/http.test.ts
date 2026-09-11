import { describe, expect, it, vi } from "vitest";

import { ErrorDatos } from "../errores";
import {
  calcularEspera,
  causaDesdeEstado,
  esperaSugeridaPorServidor,
  obtenerJson,
  obtenerRespuesta,
} from "../http";

/** Respuesta mínima que satisface lo que usa el cliente HTTP. */
function respuesta(estado: number, cuerpo: unknown = {}, cabeceras: Record<string, string> = {}) {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    statusText: "",
    headers: { get: (n: string) => cabeceras[n.toLowerCase()] ?? null },
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

/** Opciones que eliminan esperas y aleatoriedad de los tests. */
const SIN_ESPERAS = { dormir: async () => {}, aleatorio: () => 0.5 };

describe("causaDesdeEstado", () => {
  it("clasifica los códigos HTTP en causas del dominio", () => {
    expect(causaDesdeEstado(401)).toBe("no_autorizado");
    expect(causaDesdeEstado(403)).toBe("no_autorizado");
    expect(causaDesdeEstado(429)).toBe("limite_peticiones");
    expect(causaDesdeEstado(500)).toBe("servidor_externo");
    expect(causaDesdeEstado(503)).toBe("servidor_externo");
    expect(causaDesdeEstado(404)).toBe("respuesta_invalida");
  });
});

describe("calcularEspera", () => {
  it("crece exponencialmente", () => {
    const sinJitter = () => 1;
    expect(calcularEspera(0, 500, sinJitter)).toBe(500);
    expect(calcularEspera(1, 500, sinJitter)).toBe(1000);
    expect(calcularEspera(2, 500, sinJitter)).toBe(2000);
  });

  it("el jitter mantiene la espera entre el 50 % y el 100 % del exponencial", () => {
    expect(calcularEspera(1, 500, () => 0)).toBe(500);
    expect(calcularEspera(1, 500, () => 1)).toBe(1000);
  });
});

describe("esperaSugeridaPorServidor", () => {
  it("lee Retry-After en segundos", () => {
    expect(esperaSugeridaPorServidor(respuesta(429, {}, { "retry-after": "3" }))).toBe(3000);
  });

  it("lee Retry-After como fecha HTTP", () => {
    const futuro = new Date(Date.now() + 5000).toUTCString();
    const espera = esperaSugeridaPorServidor(respuesta(429, {}, { "retry-after": futuro }));
    expect(espera).toBeGreaterThan(3000);
    expect(espera).toBeLessThanOrEqual(6000);
  });

  it("devuelve null si no hay cabecera", () => {
    expect(esperaSugeridaPorServidor(respuesta(429))).toBeNull();
  });
});

describe("obtenerRespuesta", () => {
  it("devuelve la respuesta al primer intento exitoso", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { ok: true }));
    const r = await obtenerRespuesta("https://x", { proveedor: "P", fetchImpl, ...SIN_ESPERAS });

    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reintenta ante un 500 y devuelve el éxito posterior", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respuesta(500))
      .mockResolvedValueOnce(respuesta(200, { ok: true }));

    const r = await obtenerRespuesta("https://x", { proveedor: "P", fetchImpl, ...SIN_ESPERAS });

    expect(r.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reintenta ante un error de red", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(respuesta(200));

    await expect(
      obtenerRespuesta("https://x", { proveedor: "P", fetchImpl, ...SIN_ESPERAS }),
    ).resolves.toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("NO reintenta ante un 401: insistir no arregla una credencial mala", async () => {
    const fetchImpl = vi.fn(async () => respuesta(401));

    await expect(
      obtenerRespuesta("https://x", { proveedor: "P", fetchImpl, ...SIN_ESPERAS }),
    ).rejects.toMatchObject({ causa: "no_autorizado", reintentable: false });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("NO reintenta ante un 404", async () => {
    const fetchImpl = vi.fn(async () => respuesta(404));
    await expect(
      obtenerRespuesta("https://x", { proveedor: "P", fetchImpl, ...SIN_ESPERAS }),
    ).rejects.toMatchObject({ causa: "respuesta_invalida" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sí reintenta ante un 429 y respeta Retry-After", async () => {
    const dormir = vi.fn(async () => {});
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respuesta(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(respuesta(200));

    await obtenerRespuesta("https://x", {
      proveedor: "P",
      fetchImpl,
      dormir,
      aleatorio: () => 0.5,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(dormir).toHaveBeenCalledWith(2000);
  });

  it("agota los intentos y lanza el último error", async () => {
    const fetchImpl = vi.fn(async () => respuesta(503));

    await expect(
      obtenerRespuesta("https://x", { proveedor: "P", intentos: 3, fetchImpl, ...SIN_ESPERAS }),
    ).rejects.toMatchObject({ causa: "servidor_externo" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("clasifica el tiempo agotado como tal", async () => {
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(timeout);

    await expect(
      obtenerRespuesta("https://x", { proveedor: "P", intentos: 2, fetchImpl, ...SIN_ESPERAS }),
    ).rejects.toMatchObject({ causa: "tiempo_agotado" });
  });

  it("los errores traen mensaje en español para el usuario", async () => {
    const fetchImpl = vi.fn(async () => respuesta(401));

    try {
      await obtenerRespuesta("https://x", { proveedor: "Barchart", fetchImpl, ...SIN_ESPERAS });
      expect.unreachable("debía lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDatos);
      expect((error as ErrorDatos).mensajeUsuario).toBe(
        "Barchart rechazó las credenciales. Verifique la API key.",
      );
    }
  });
});

describe("obtenerJson", () => {
  it("devuelve el cuerpo parseado", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { valor: 42 }));
    await expect(
      obtenerJson<{ valor: number }>("https://x", { proveedor: "P", fetchImpl, ...SIN_ESPERAS }),
    ).resolves.toEqual({ valor: 42 });
  });

  it("informa con claridad si el cuerpo no es JSON", async () => {
    const rota = {
      ok: true,
      status: 200,
      statusText: "",
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response;

    await expect(
      obtenerJson("https://x", { proveedor: "P", fetchImpl: async () => rota, ...SIN_ESPERAS }),
    ).rejects.toMatchObject({ causa: "respuesta_invalida" });
  });
});
