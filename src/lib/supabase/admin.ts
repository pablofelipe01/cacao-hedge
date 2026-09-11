import "server-only";

import { createClient } from "@supabase/supabase-js";

import { claveServiceRole, envPublico } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Cliente con service_role: SALTA ROW LEVEL SECURITY.
 *
 * Uso exclusivo del backend y unicamente para la cache compartida de
 * `precios`, que ningun usuario puede escribir. Nunca lo uses para leer
 * o escribir datos de un usuario: para eso esta crearClienteServidor().
 */
export function crearClienteAdmin() {
  return createClient<Database>(envPublico.supabaseUrl, claveServiceRole(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
