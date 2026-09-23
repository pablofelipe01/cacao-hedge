/**
 * Traducción de una fila de `ventas` a lo que consume el motor.
 *
 * Vive aparte porque la usan dos pantallas —Ventas y Posición— y el
 * detalle que importa es fácil de hacer mal: el porcentaje se guarda
 * como se escribe (−5) y el motor lo quiere como fracción (−0,05).
 */

import type { Diferencial, VentaComprometida } from "@/lib/engine/consolidado";
import type { Fila } from "@/types/database";

export function diferencialDeVenta(
  fila: Pick<Fila<"ventas">, "diferencial" | "unidad_diferencial">,
): Diferencial | null {
  if (fila.diferencial == null || fila.unidad_diferencial == null) return null;
  const valor = Number(fila.diferencial);
  return fila.unidad_diferencial === "porcentaje"
    ? { tipo: "fraccion", valor: valor / 100 }
    : { tipo: "usd_tm", valor };
}

export function ventaDesdeFila(fila: Fila<"ventas">): VentaComprometida {
  return {
    id: fila.id,
    comprador: fila.comprador,
    toneladas: Number(fila.toneladas),
    fechaEmbarque: fila.fecha_embarque,
    modalidad: fila.modalidad,
    precioUsdTm: fila.precio_usd_tm != null ? Number(fila.precio_usd_tm) : null,
    diferencial: diferencialDeVenta(fila),
  };
}

/** «NY −5 %», «NY +150 USD/TM», «6.500 USD/TM»: cómo se pactó, en corto. */
export function describirPrecio(
  fila: Pick<Fila<"ventas">, "modalidad" | "precio_usd_tm" | "diferencial" | "unidad_diferencial">,
): string {
  if (fila.modalidad === "precio_pactado") {
    return `${Number(fila.precio_usd_tm).toLocaleString("es-CO", { maximumFractionDigits: 2 })} USD/TM`;
  }
  const valor = Number(fila.diferencial ?? 0);
  if (valor === 0) return "NY exacto";
  const signo = valor > 0 ? "+" : "−";
  const abs = Math.abs(valor).toLocaleString("es-CO", { maximumFractionDigits: 3 });
  return fila.unidad_diferencial === "porcentaje" ? `NY ${signo}${abs} %` : `NY ${signo}${abs} USD/TM`;
}
