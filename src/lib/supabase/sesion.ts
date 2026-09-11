import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { envPublico } from "@/lib/env";
import type { Database } from "@/types/database";

/** Rutas accesibles sin sesion iniciada. */
const RUTAS_PUBLICAS = ["/login", "/auth"];

/**
 * Refresca el token de Supabase en cada peticion y protege las rutas
 * privadas. El middleware es el unico lugar donde se pueden reescribir
 * las cookies de sesion de forma fiable en el App Router.
 */
export async function actualizarSesion(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    envPublico.supabaseUrl,
    envPublico.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesNuevas) {
          for (const { name, value } of cookiesNuevas) {
            request.cookies.set(name, value);
          }
          respuesta = NextResponse.next({ request });
          for (const { name, value, options } of cookiesNuevas) {
            respuesta.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // No insertar logica entre createServerClient y getUser: cualquier
  // await intermedio puede dejar la sesion sin refrescar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ruta = request.nextUrl.pathname;
  const esPublica = RUTAS_PUBLICAS.some(
    (publica) => ruta === publica || ruta.startsWith(`${publica}/`),
  );

  if (!user && !esPublica) {
    // Las rutas de API responden con 401 en JSON, nunca con un redirect:
    // un fetch seguiría la redirección y recibiría el HTML del login, que
    // al parsearse como JSON falla con un error que no dice nada útil.
    if (ruta.startsWith("/api/")) {
      return NextResponse.json({ error: "Debe iniciar sesión." }, { status: 401 });
    }

    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.searchParams.set("redirigir", ruta);
    return NextResponse.redirect(destino);
  }

  // Un usuario con sesión no tiene nada que hacer en el login.
  if (user && ruta === "/login") {
    const destino = request.nextUrl.clone();
    destino.pathname = "/dashboard";
    destino.search = "";
    return NextResponse.redirect(destino);
  }

  return respuesta;
}
