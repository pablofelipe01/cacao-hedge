"use server";

import { redirect } from "next/navigation";

import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import type { EstadoFormulario } from "./inventario";

/** Mínimo que exige Supabase; más abajo no lo acepta el servidor de Auth. */
const MINIMO = 8;

/**
 * Establece o cambia la contraseña del usuario en sesión.
 *
 * Es el destino del enlace de recuperación: Supabase deja la sesión
 * iniciada tras canjear el token, y aquí se fija la clave. El servidor
 * nunca recibe la contraseña anterior porque no hace falta: quien llega
 * aquí ya demostró el control del correo.
 */
export async function establecerClave(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const usuario = await obtenerUsuario();
  if (!usuario) {
    return {
      mensaje:
        "El enlace expiró o no hay sesión. Pida uno nuevo desde la pantalla de acceso.",
    };
  }

  const clave = String(formData.get("clave") ?? "");
  const repetida = String(formData.get("repetida") ?? "");

  if (clave.length < MINIMO) {
    return { errores: { clave: `La contraseña debe tener al menos ${MINIMO} caracteres.` } };
  }
  if (clave !== repetida) {
    return { errores: { repetida: "Las dos contraseñas no coinciden." } };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.updateUser({ password: clave });

  if (error) {
    return { mensaje: `No se pudo guardar la contraseña: ${error.message}` };
  }

  redirect("/dashboard");
}
