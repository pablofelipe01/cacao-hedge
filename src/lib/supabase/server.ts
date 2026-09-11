import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { envPublico } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Cliente de Supabase para server components, server actions y route
 * handlers. Respeta RLS: opera con la sesion del usuario autenticado.
 */
export async function crearClienteServidor() {
  const almacenCookies = await cookies();

  return createServerClient<Database>(
    envPublico.supabaseUrl,
    envPublico.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return almacenCookies.getAll();
        },
        setAll(cookiesNuevas) {
          try {
            for (const { name, value, options } of cookiesNuevas) {
              almacenCookies.set(name, value, options);
            }
          } catch {
            // Los server components no pueden escribir cookies. El refresco
            // de sesion lo hace el middleware, asi que este caso es benigno.
          }
        },
      },
    },
  );
}

/**
 * Devuelve el usuario autenticado o null.
 *
 * Usa getUser() (valida el JWT contra el servidor de Auth) y no
 * getSession(), cuyo contenido proviene de la cookie y es falsificable.
 */
export async function obtenerUsuario() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
