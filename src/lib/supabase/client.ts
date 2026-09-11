"use client";

import { createBrowserClient } from "@supabase/ssr";

import { envPublico } from "@/lib/env";
import type { Database } from "@/types/database";

/** Cliente de Supabase para componentes de cliente. Solo usa la anon key. */
export function crearClienteNavegador() {
  return createBrowserClient<Database>(
    envPublico.supabaseUrl,
    envPublico.supabaseAnonKey,
  );
}
