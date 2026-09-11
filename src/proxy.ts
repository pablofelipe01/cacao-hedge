import type { NextRequest } from "next/server";

import { actualizarSesion } from "@/lib/supabase/sesion";

/**
 * Se ejecuta antes de cada petición: refresca el token de Supabase y
 * redirige a /login las rutas privadas sin sesión.
 *
 * En Next.js 16 esta convención se llama `proxy` (antes `middleware`).
 */
export async function proxy(request: NextRequest) {
  return actualizarSesion(request);
}

export const config = {
  matcher: [
    /*
     * Todas las rutas salvo estáticos e imágenes, que no necesitan
     * sesión y encarecerían el proxy innecesariamente.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
