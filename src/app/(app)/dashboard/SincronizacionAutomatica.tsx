"use client";

import { useEffect, useState, useTransition } from "react";

import { sincronizarBodegaSiVieja } from "@/lib/acciones/bodega";

/**
 * Pone al día la bodega al abrir el inventario, sin que haya que pedirlo.
 *
 * La pantalla se pinta primero con lo que hay en la base —mejor ver algo
 * al instante que esperar a la hoja— y, si eso tiene más de media hora,
 * se lee la hoja por detrás y la acción refresca la página al terminar.
 */
export function SincronizacionAutomatica({ sincronizadoEn }: { sincronizadoEn: string | null }) {
  const [actualizando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    iniciar(async () => {
      const r = await sincronizarBodegaSiVieja();
      setError(r.error ?? null);
    });
  }, []);

  const leida = sincronizadoEn
    ? new Date(sincronizadoEn).toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  let texto: string;
  if (actualizando) texto = "Actualizando desde la hoja de inventario…";
  // Las cifras de la pantalla siguen siendo las de la última lectura buena:
  // hay que decir de cuándo son, o parecen las de hoy.
  else if (error)
    texto = `No se pudo leer la hoja: ${error}${
      leida ? ` Las cifras que se ven son de la lectura del ${leida}.` : ""
    }`;
  else if (leida)
    texto = `Según la hoja de inventario, leída el ${leida}. Se vuelve a leer sola cada media hora.`;
  else texto = "Todavía no se ha leído la hoja de inventario.";

  return (
    <p
      role="status"
      className={`text-xs ${error ? "text-negativo" : "text-texto-suave"}`}
    >
      {texto}
    </p>
  );
}
