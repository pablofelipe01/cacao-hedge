import { NextResponse, type NextRequest } from "next/server";

import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Destino del enlace de confirmación de correo y de los flujos OAuth /
 * magic link. Canjea el `code` por una sesión y redirige al dashboard.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const siguiente = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=codigo_ausente`);
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  const destino = siguiente.startsWith("/") ? siguiente : "/dashboard";
  return NextResponse.redirect(`${origin}${destino}`);
}
