import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { envAnthropic } from "@/lib/env";

/**
 * Cliente de Anthropic. Solo servidor: la API key nunca puede salir al
 * navegador, y `server-only` hace que importarlo desde un componente de
 * cliente falle en tiempo de compilación en vez de filtrarla en runtime.
 */
export function crearClienteAnthropic() {
  const { apiKey, modelo } = envAnthropic();
  return { cliente: new Anthropic({ apiKey }), modelo };
}
