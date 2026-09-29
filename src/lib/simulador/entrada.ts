/**
 * Un caso hipotético tal como lo escribe el usuario.
 *
 * Lo comparten tres sitios —el formulario, la acción que lo calcula y el
 * analista del chat, que arma casos a partir de lo que le cuentan—, y por
 * eso vive aparte: si cada uno interpretara «−23» o «50» a su manera, el
 * caso que el chat pasa al formulario no daría las cifras que acaba de
 * citar.
 *
 * Las unidades son las del usuario: porcentajes como se escriben (−23 =
 * 23 % bajo NY, 50 = 50 %), pesos enteros, USD/TM. La conversión a las
 * del motor ocurre en un solo sitio, `casoDesdeEntrada`.
 */

import { z } from "zod";

import type { CasoHipotetico } from "@/lib/engine/simulador";

export interface EntradaCaso {
  /** Opcional: solo sirve para registrar el caso como venta real. */
  comprador: string;
  precioVentaUsdTm: number;
  entregas: { fecha: string; toneladas: number }[];
  /** −23 = compra un 23 % por debajo de Nueva York. */
  descuentoCompraPct: number;
  diasCompraAntes: number;
  /** 50 = 50 % del valor de cada entrega. */
  anticipoPct: number;
  diasAnticipoAntes: number;
  diasSaldoDespues: number;
  costosUsdTm: number;
  capitalCop: number;
}

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const dias = (etiqueta: string) =>
  z.number({ error: `${etiqueta}: escriba un número.` }).min(0, `${etiqueta}: no puede ser negativo.`).max(365, `${etiqueta}: más de un año no tiene sentido aquí.`);

export const esquemaEntradaCaso = z.object({
  comprador: z.string().trim().max(120).default(""),
  precioVentaUsdTm: z
    .number({ error: "Precio de venta: escriba un número." })
    .positive("El precio de venta debe ser mayor que cero.")
    .max(50_000, "Precio de venta: revise la cifra, está en USD/TM."),
  entregas: z
    .array(
      z.object({
        fecha: fechaIso,
        toneladas: z.number().positive("Cada entrega debe tener toneladas.").max(10_000),
      }),
    )
    .min(1, "Hace falta al menos una entrega.")
    .max(52, "Máximo 52 entregas."),
  descuentoCompraPct: z
    .number({ error: "Descuento de compra: escriba un número." })
    .gt(-100, "El descuento debe estar entre −100 % y +100 %.")
    .lt(100, "El descuento debe estar entre −100 % y +100 %."),
  diasCompraAntes: dias("Días de compra"),
  anticipoPct: z.number().min(0, "El anticipo va de 0 % a 100 %.").max(100, "El anticipo va de 0 % a 100 %."),
  diasAnticipoAntes: dias("Días del anticipo"),
  diasSaldoDespues: dias("Días del saldo"),
  costosUsdTm: z.number().min(0, "Los costos no pueden ser negativos.").max(10_000),
  capitalCop: z.number().min(0, "El capital no puede ser negativo."),
});

/** Traduce la entrada del usuario a las unidades del motor. */
export function casoDesdeEntrada(entrada: EntradaCaso, hoy: string): CasoHipotetico {
  return {
    hoy,
    precioVentaUsdTm: entrada.precioVentaUsdTm,
    entregas: entrada.entregas.map((e) => ({ fecha: e.fecha, toneladas: e.toneladas })),
    diferencialCompra: { tipo: "fraccion", valor: entrada.descuentoCompraPct / 100 },
    diasCompraAntes: entrada.diasCompraAntes,
    anticipo: { fraccion: entrada.anticipoPct / 100, diasAntesEntrega: entrada.diasAnticipoAntes },
    diasSaldoDespues: entrada.diasSaldoDespues,
    costosUsdTm: entrada.costosUsdTm,
    capitalCop: entrada.capitalCop,
  };
}

/** Los mensajes de validación, uno por línea, sin repetir. */
export function mensajesDeError(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => i.message))];
}
