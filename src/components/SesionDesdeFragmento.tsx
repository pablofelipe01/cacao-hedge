"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { crearClienteNavegador } from "@/lib/supabase/client";

/**
 * Establece la sesión a partir del fragmento de la URL.
 *
 * Los enlaces de recuperación y los magic link de Supabase devuelven los
 * tokens en el fragmento (`#access_token=…`), no como parámetro de
 * consulta. El fragmento **nunca se envía al servidor**, así que el route
 * handler de `/auth/callback` —que espera un `?code=`— no puede verlos:
 * sin esto, cualquier enlace de recuperación aterriza aquí y no pasa nada.
 *
 * Se ejecuta en el cliente, canjea los tokens por una sesión y limpia el
 * fragmento para que los tokens no queden en la barra de direcciones ni
 * en el historial.
 *
 * Vive en el layout raíz y no en la pantalla de acceso porque el enlace
 * aterriza en la Site URL configurada en Supabase, que redirige según
 * haya sesión o no: el fragmento sobrevive al salto, pero el destino
 * varía. Montado en la raíz da igual dónde caiga. Sin fragmento no hace
 * absolutamente nada.
 */
export function SesionDesdeFragmento() {
  const router = useRouter();
  // Solo se toca en los callbacks asíncronos: cambiarlo de forma síncrona
  // dentro del efecto encadenaría renders sin necesidad.
  const [error, setError] = useState(false);

  useEffect(() => {
    const fragmento = window.location.hash.slice(1);
    if (!fragmento.includes("access_token")) return;

    const parametros = new URLSearchParams(fragmento);
    const access_token = parametros.get("access_token");
    const refresh_token = parametros.get("refresh_token");
    if (!access_token || !refresh_token) return;

    const supabase = crearClienteNavegador();
    supabase.auth
      .setSession({ access_token, refresh_token })
      .then(({ error: fallo }) => {
        // Fuera los tokens de la barra de direcciones y del historial.
        window.history.replaceState(null, "", window.location.pathname);

        if (fallo) {
          setError(true);
          return;
        }

        // Un enlace de recuperación existe para poner contraseña nueva;
        // llevar al usuario al panel lo dejaría a medias.
        router.replace(parametros.get("type") === "recovery" ? "/clave" : "/dashboard");
      })
      .catch(() => setError(true));
  }, [router]);

  if (!error) return null;

  return (
    <p
      role="alert"
      className="rounded-md border border-negativo/40 bg-negativo/5 px-3 py-2 text-sm text-negativo"
    >
      El enlace expiró o ya se usó. Pida uno nuevo.
    </p>
  );
}
