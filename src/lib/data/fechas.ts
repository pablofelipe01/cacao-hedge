/** Utilidades de fecha para series de mercado. Todo en ISO `yyyy-mm-dd`. */

/** Convierte a `yyyy-mm-dd` leyendo la fecha en UTC. */
export function aFechaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Día de negociación de una barra de Yahoo.
 *
 * Yahoo entrega el timestamp de la medianoche local de la bolsa expresada
 * como instante UTC. Sumarle el desplazamiento de la bolsa devuelve esa
 * medianoche a las 00:00 UTC, de donde la fecha sale sin ambigüedad; leer
 * el timestamp crudo fallaría en las bolsas con desplazamiento positivo.
 */
export function diaDeNegociacion(timestampSegundos: number, desplazamientoSegundos: number): string {
  return aFechaIso(new Date((timestampSegundos + desplazamientoSegundos) * 1000));
}

/** Resta días a una fecha ISO. */
export function restarDias(fechaIso: string, dias: number): string {
  const fecha = new Date(`${fechaIso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - dias);
  return aFechaIso(fecha);
}

/** Días calendario entre dos fechas ISO (positivo si `hasta` es posterior). */
export function diasEntre(desde: string, hasta: string): number {
  const ms =
    new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** true si la cadena tiene forma `yyyy-mm-dd` y es una fecha real. */
export function esFechaIso(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && aFechaIso(fecha) === valor;
}
