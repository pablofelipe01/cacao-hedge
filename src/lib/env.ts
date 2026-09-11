/**
 * Lectura y validación de variables de entorno.
 *
 * Cada secreto se valida por separado y solo cuando se va a usar. Una
 * validación conjunta haría que, por ejemplo, la ruta de precios fallara
 * con un 500 por faltar la clave de Anthropic, que no necesita para nada.
 */

function requerida(nombre: string, valor: string | undefined): string {
  if (!valor || valor.trim() === "") {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Copie .env.example a .env.local y complétela.`,
    );
  }
  return valor;
}

/**
 * Variables visibles en el navegador (prefijo NEXT_PUBLIC_).
 *
 * Se leen con getters, no al cargar el módulo: si se validaran al
 * importar, cualquier archivo que arrastre `env.ts` en su cadena de
 * imports reventaría sin las variables presentes, aunque no las use.
 * Next sustituye `process.env.NEXT_PUBLIC_*` en tiempo de compilación
 * también dentro de un getter, así que el navegador sigue recibiendo el
 * valor literal.
 */
export const envPublico = {
  get supabaseUrl(): string {
    return requerida("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return requerida(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
  get siteUrl(): string {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  },
};

/**
 * Service role key de Supabase. Salta RLS, así que solo la usa el backend
 * para escribir la caché compartida de `precios`.
 *
 * Lanza si falta: quien la necesita debe decidir si degrada o falla.
 */
export function claveServiceRole(): string {
  return requerida("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** true si hay service role key configurada, sin lanzar. */
export function hayClaveServiceRole(): boolean {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim() !== "";
}

/** Credenciales de Anthropic para el informe narrativo (fase 5). */
export function envAnthropic() {
  return {
    apiKey: requerida("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY),
    modelo: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  };
}

/**
 * Configuración de las fuentes de mercado.
 *
 * Ninguna es obligatoria: sin API key de Barchart se usa Yahoo, y el
 * endpoint de la TRM y el token de Socrata tienen valores por defecto que
 * funcionan. Por eso esta función nunca lanza.
 */
export function envDatosMercado() {
  return {
    barchartApiKey: process.env.BARCHART_API_KEY ?? "",
    trmEndpoint:
      process.env.TRM_ENDPOINT ?? "https://www.datos.gov.co/resource/32sa-8pi3.json",
    socrataAppToken: process.env.SOCRATA_APP_TOKEN ?? "",
  };
}
