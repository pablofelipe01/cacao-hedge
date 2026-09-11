import { NextResponse } from "next/server";

import { envDatosMercado, hayClaveServiceRole } from "@/lib/env";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { ErrorDatos } from "@/lib/data/errores";
import { elegirProveedor, obtenerMercado } from "@/lib/data/mercado";

/** Los precios cambian a lo largo del día: nunca se cachea esta ruta. */
export const dynamic = "force-dynamic";

/**
 * Refresca la caché de precios y devuelve la fotografía de mercado.
 *
 * Exige sesión: la caché de `precios` es un recurso compartido y no tiene
 * por qué poder llenarla cualquiera desde fuera.
 */
export async function GET() {
  const usuario = await obtenerUsuario();
  if (!usuario) {
    return NextResponse.json({ error: "Debe iniciar sesión." }, { status: 401 });
  }

  try {
    const { barchartApiKey, trmEndpoint, socrataAppToken } = envDatosMercado();
    const cliente = await crearClienteServidor();

    // Sin service role key el análisis funciona igual: solo deja de cachear,
    // así que se consulta antes de construir el cliente administrador.
    const clienteAdmin = hayClaveServiceRole() ? crearClienteAdmin() : undefined;

    const resultado = await obtenerMercado({
      cliente,
      clienteAdmin,
      proveedor: elegirProveedor(barchartApiKey),
      opcionesTrm: { endpoint: trmEndpoint, appToken: socrataAppToken },
    });

    return NextResponse.json({
      ...resultado,
      // Sin caché activa el análisis sigue funcionando, pero cada corrida
      // vuelve a consultar las fuentes externas.
      cacheActiva: clienteAdmin !== undefined,
    });
  } catch (error) {
    if (error instanceof ErrorDatos) {
      return NextResponse.json(
        { error: error.mensajeUsuario, causa: error.causa, proveedor: error.proveedor },
        { status: error.causa === "no_autorizado" ? 502 : 503 },
      );
    }

    return NextResponse.json(
      { error: "No se pudieron obtener los datos de mercado." },
      { status: 500 },
    );
  }
}
