import Anthropic from "@anthropic-ai/sdk";

import { crearClienteAnthropic } from "./cliente";
import { PROMPT_SISTEMA, construirMensaje } from "./prompt";
import { verificarCifras, type ResultadoVerificacion } from "./verificacion";
import type { ResumenCuantitativo } from "./resumen";

export interface InformeGenerado {
  /** Narrativa en Markdown. */
  markdown: string;
  meta: {
    modelo: string;
    tokensEntrada: number;
    tokensSalida: number;
    generadoEn: string;
    verificacion: {
      totalCitadas: number;
      rastreables: number;
      limpio: boolean;
      /** Cifras que no rastrean a los datos, con su contexto. */
      sospechosas: { textual: string; contexto: string }[];
    };
  };
}

export class ErrorInforme extends Error {
  readonly causa: "sin_credenciales" | "limite" | "rechazo" | "api" | "vacio";
  readonly reintentable: boolean;

  constructor(causa: ErrorInforme["causa"], mensaje: string, reintentable = false) {
    super(mensaje);
    this.name = "ErrorInforme";
    this.causa = causa;
    this.reintentable = reintentable;
  }

  get mensajeUsuario(): string {
    switch (this.causa) {
      case "sin_credenciales":
        return "Falta configurar ANTHROPIC_API_KEY en el servidor.";
      case "limite":
        return "El servicio de redacción está saturado. Intente de nuevo en unos minutos.";
      case "rechazo":
        return "El modelo declinó redactar este informe. Revise los datos del análisis.";
      case "vacio":
        return "El modelo no devolvió texto. Intente de nuevo.";
      case "api":
        return "No se pudo generar el informe narrativo. El análisis cuantitativo no se ve afectado.";
    }
  }
}

/** Concatena los bloques de texto de la respuesta. */
function extraerTexto(contenido: Anthropic.ContentBlock[]): string {
  return contenido
    .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === "text")
    .map((bloque) => bloque.text)
    .join("")
    .trim();
}

/** Lo que este módulo necesita del SDK: permite inyectarlo en los tests. */
export interface ClienteMensajes {
  messages: {
    create(parametros: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface OpcionesInforme {
  /** Cliente y modelo. Por defecto se construyen desde el entorno. */
  cliente?: ClienteMensajes;
  modelo?: string;
}

/**
 * Genera el informe ejecutivo narrativo.
 *
 * El modelo recibe únicamente el resumen cuantitativo y, al volver, se
 * comprueba que cada cifra del texto rastree a ese resumen. La
 * verificación no bloquea la entrega —un informe con una cifra dudosa
 * sigue siendo útil— pero viaja con el resultado para que la interfaz
 * pueda avisarle al usuario en vez de presentarlo como palabra sagrada.
 */
export async function generarInforme(
  resumen: ResumenCuantitativo,
  opciones: OpcionesInforme = {},
): Promise<InformeGenerado> {
  const desdeEntorno = opciones.cliente ? null : crearClienteAnthropic();
  const cliente = opciones.cliente ?? desdeEntorno!.cliente;
  const modelo = opciones.modelo ?? desdeEntorno?.modelo ?? "claude-opus-5";

  let respuesta: Anthropic.Message;
  try {
    respuesta = await cliente.messages.create({
      model: modelo,
      max_tokens: 8000,
      system: PROMPT_SISTEMA,
      // Pensamiento adaptativo: el modelo decide cuánto razonar antes de
      // redactar. La tarea es de interpretación, no de cálculo.
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: construirMensaje(resumen) }],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      throw new ErrorInforme("sin_credenciales", "La API key de Anthropic fue rechazada.");
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new ErrorInforme("limite", "Se alcanzó el límite de peticiones.", true);
    }
    if (error instanceof Anthropic.APIError) {
      throw new ErrorInforme("api", `Anthropic respondió ${error.status}.`, (error.status ?? 0) >= 500);
    }
    throw new ErrorInforme("api", "No se pudo contactar con Anthropic.", true);
  }

  // Los clasificadores de seguridad pueden declinar: hay que mirarlo antes
  // de leer el contenido, que en ese caso viene vacío o truncado.
  if (respuesta.stop_reason === "refusal") {
    throw new ErrorInforme("rechazo", "El modelo declinó la petición.");
  }

  const markdown = extraerTexto(respuesta.content);
  if (!markdown) {
    throw new ErrorInforme("vacio", "La respuesta no contiene texto.");
  }

  const verificacion: ResultadoVerificacion = verificarCifras(markdown, resumen);

  return {
    markdown,
    meta: {
      modelo: respuesta.model,
      tokensEntrada: respuesta.usage.input_tokens,
      tokensSalida: respuesta.usage.output_tokens,
      generadoEn: new Date().toISOString(),
      verificacion: {
        totalCitadas: verificacion.totalCitadas,
        rastreables: verificacion.rastreables,
        limpio: verificacion.limpio,
        sospechosas: verificacion.sospechosas.map((s) => ({
          textual: s.textual,
          contexto: s.contexto,
        })),
      },
    },
  };
}
