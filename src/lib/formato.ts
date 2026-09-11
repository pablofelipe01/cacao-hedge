/**
 * Formato de cifras para la interfaz, en convención colombiana:
 * punto como separador de miles y coma como decimal.
 *
 * Los montos en pesos se abrevian porque un análisis maneja cientos de
 * millones y la cifra exacta al peso no aporta nada: lo que se compara
 * son órdenes de magnitud entre estrategias.
 */

const LOCALE = "es-CO";

/**
 * Pesos abreviados: 656.843.211 → "656,8 M".
 *
 * Se usa «mil M» y no «MM» para los miles de millones: en Colombia «MM»
 * se lee habitualmente como millones, y confundir millones con miles de
 * millones por un factor de mil no es un detalle tipográfico en una
 * herramienta que sirve para decidir coberturas.
 */
export function cop(valor: number, decimales = 1): string {
  const abs = Math.abs(valor);
  const formatear = (v: number, d: number) =>
    v.toLocaleString(LOCALE, { maximumFractionDigits: d });

  // Dos decimales como mínimo en esta escala: con uno, 1.986,5 millones
  // se imprimía «2 mil M» y perdía la cifra significativa.
  if (abs >= 1e9) return `${formatear(valor / 1e9, Math.max(decimales, 2))} mil M`;
  if (abs >= 1e6) return `${formatear(valor / 1e6, decimales)} M`;
  if (abs >= 1e3) return `${formatear(valor / 1e3, 0)} k`;

  return formatear(valor, 0);
}

/** Pesos completos, para tablas y detalle. */
export function copExacto(valor: number): string {
  return valor.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}

/** Dólares por tonelada métrica. */
export function usdTm(valor: number, decimales = 0): string {
  return valor.toLocaleString(LOCALE, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** Porcentaje a partir de un decimal: 0.108 → "10,8 %". */
export function porcentaje(valor: number, decimales = 1): string {
  return `${(valor * 100).toLocaleString(LOCALE, {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })} %`;
}

/** Toneladas con hasta tres decimales. */
export function toneladas(valor: number): string {
  return valor.toLocaleString(LOCALE, { maximumFractionDigits: 3 });
}

/** Fecha ISO a formato legible: "2026-12-15" → "15 dic 2026". */
export function fechaLegible(iso: string): string {
  const fecha = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return iso;

  return fecha.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Días calendario entre hoy y una fecha ISO. */
export function diasHasta(iso: string, hoy = new Date()): number {
  const destino = new Date(`${iso}T00:00:00Z`).getTime();
  const inicio = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  return Math.round((destino - inicio) / 86_400_000);
}

/** Prefijo de signo explícito para variaciones. */
export function conSigno(valor: number, formateador: (v: number) => string): string {
  return `${valor > 0 ? "+" : ""}${formateador(valor)}`;
}
