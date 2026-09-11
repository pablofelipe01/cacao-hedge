"use server";

import { redirect } from "next/navigation";

import { crearClienteServidor } from "@/lib/supabase/server";
import { envPublico } from "@/lib/env";

export type EstadoFormulario = {
  error?: string;
  aviso?: string;
};

/** Traduce los errores de Supabase Auth a mensajes accionables en español. */
function traducirError(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (m.includes("email not confirmed")) {
    return "La cuenta existe pero el correo no está confirmado. Revise su bandeja o desactive la confirmación de correo en el panel de Supabase.";
  }
  if (m.includes("user already registered")) {
    return "Ese correo ya tiene una cuenta. Use «Iniciar sesión».";
  }
  if (m.includes("password should be")) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Demasiados intentos seguidos. Espere un momento y vuelva a intentar.";
  }
  return mensaje;
}

function leerCredenciales(formData: FormData) {
  const correo = String(formData.get("correo") ?? "").trim();
  const clave = String(formData.get("clave") ?? "");
  return { correo, clave };
}

export async function iniciarSesion(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const { correo, clave } = leerCredenciales(formData);
  if (!correo || !clave) {
    return { error: "Ingrese correo y contraseña." };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: clave,
  });

  if (error) return { error: traducirError(error.message) };

  const destino = String(formData.get("redirigir") ?? "/dashboard");
  // Solo rutas internas: evita un redirect abierto hacia otro dominio.
  redirect(destino.startsWith("/") ? destino : "/dashboard");
}

export async function registrarse(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const { correo, clave } = leerCredenciales(formData);
  if (!correo || !clave) {
    return { error: "Ingrese correo y contraseña." };
  }

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.auth.signUp({
    email: correo,
    password: clave,
    options: { emailRedirectTo: `${envPublico.siteUrl}/auth/callback` },
  });

  if (error) return { error: traducirError(error.message) };

  // Con confirmación de correo activa, Supabase devuelve el usuario sin
  // sesión: hay que pasar por el enlace enviado por correo.
  if (data.session) redirect("/dashboard");

  return {
    aviso:
      "Cuenta creada. Revise su correo y abra el enlace de confirmación para entrar.",
  };
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
