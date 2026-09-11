/**
 * Escala divergente para la utilidad en pesos.
 *
 * La utilidad tiene un punto medio con significado real —el cero, donde
 * el lote deja de ganar y empieza a perder—, así que la escala es
 * divergente y no secuencial: dos polos que se leen como opuestos y un
 * gris neutro en el centro.
 *
 * Azul/rojo en vez del verde/rojo habitual en finanzas: esos dos son
 * justo el par que un daltónico protán o deután no distingue, y aquí la
 * diferencia entre ganar y perder no puede depender de eso.
 */

/** Pasos de la rampa, de pérdida grave a ganancia alta. */
const PASOS = [
  "var(--viz-neg-3)",
  "var(--viz-neg-2)",
  "var(--viz-neg-1)",
  "var(--viz-cero)",
  "var(--viz-pos-1)",
  "var(--viz-pos-2)",
  "var(--viz-pos-3)",
] as const;

/** Índice del paso neutro dentro de la rampa. */
const NEUTRO = 3;

/**
 * Color para un valor, dado el mayor valor absoluto de la matriz.
 *
 * La escala se normaliza con el extremo absoluto para que el cero quede
 * exactamente en el centro: normalizar por mínimo y máximo desplazaría
 * el neutro y pintaría de "ganancia" una pérdida pequeña.
 */
export function colorDivergente(valor: number, extremoAbsoluto: number): string {
  if (extremoAbsoluto <= 0) return PASOS[NEUTRO];

  const normalizado = Math.max(-1, Math.min(1, valor / extremoAbsoluto));
  const desplazamiento = Math.round(normalizado * NEUTRO);

  return PASOS[NEUTRO + desplazamiento];
}

/**
 * Color de texto legible sobre el color de fondo calculado.
 *
 * Solo los dos pasos más intensos de cada brazo necesitan texto claro;
 * el resto se lee mejor con la tinta normal.
 */
export function tintaSobre(valor: number, extremoAbsoluto: number): string {
  if (extremoAbsoluto <= 0) return "var(--texto)";

  const intensidad = Math.abs(valor) / extremoAbsoluto;
  return intensidad > 0.5 ? "#ffffff" : "var(--texto)";
}

/** Mayor valor absoluto de una serie: define los extremos de la rampa. */
export function extremoAbsoluto(valores: readonly number[]): number {
  return valores.reduce((mayor, v) => Math.max(mayor, Math.abs(v)), 0);
}

/** Los siete pasos, para pintar la leyenda de la escala. */
export const PASOS_ESCALA = PASOS;
