import { describe, expect, it } from "vitest";

import { ErrorDatos, type CausaError } from "../errores";

describe("ErrorDatos", () => {
  it("marca como reintentables solo las causas transitorias", () => {
    const reintentables: CausaError[] = ["red", "tiempo_agotado", "servidor_externo"];
    const definitivas: CausaError[] = [
      "sin_credenciales",
      "no_autorizado",
      "sin_datos",
      "respuesta_invalida",
      "limite_peticiones",
    ];

    for (const causa of reintentables) {
      expect(new ErrorDatos("P", causa, "x").reintentable).toBe(true);
    }
    for (const causa of definitivas) {
      expect(new ErrorDatos("P", causa, "x").reintentable).toBe(false);
    }
  });

  it("permite forzar el carácter reintentable", () => {
    expect(new ErrorDatos("P", "sin_datos", "x", { reintentable: true }).reintentable).toBe(true);
  });

  it("da un mensaje en español y accionable para cada causa", () => {
    const causas: CausaError[] = [
      "sin_credenciales", "red", "tiempo_agotado", "limite_peticiones",
      "no_autorizado", "sin_datos", "respuesta_invalida", "servidor_externo",
    ];

    for (const causa of causas) {
      const mensaje = new ErrorDatos("Yahoo", causa, "detalle técnico").mensajeUsuario;

      expect(mensaje).toContain("Yahoo");
      expect(mensaje.length).toBeGreaterThan(20);
      // El mensaje al usuario nunca debe filtrar el detalle técnico interno.
      expect(mensaje).not.toContain("detalle técnico");
    }
  });

  it("conserva el estado HTTP y la causa original", () => {
    const causaOriginal = new Error("socket hang up");
    const error = new ErrorDatos("P", "servidor_externo", "falló", {
      estadoHttp: 503,
      cause: causaOriginal,
    });

    expect(error.name).toBe("ErrorDatos");
    expect(error.estadoHttp).toBe(503);
    expect(error.cause).toBe(causaOriginal);
    expect(error.proveedor).toBe("P");
    expect(error).toBeInstanceOf(Error);
  });
});
