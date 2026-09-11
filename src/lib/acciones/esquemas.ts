/**
 * Esquemas de validación de los formularios.
 *
 * Se validan en el servidor porque el navegador no es una frontera de
 * confianza: los `required` y `min` del HTML son ayudas de usabilidad,
 * no garantías.
 */

import { z } from "zod";

/** Convierte una cadena de formulario a número aceptando coma decimal. */
const numeroDeTexto = z
  .string()
  .trim()
  .transform((valor) => Number(valor.replace(/\./g, "").replace(",", ".")));

const numeroPositivo = (etiqueta: string) =>
  numeroDeTexto.pipe(
    z.number({ error: `${etiqueta} debe ser un número.` }).positive(`${etiqueta} debe ser mayor que cero.`),
  );

const numeroNoNegativo = (etiqueta: string) =>
  numeroDeTexto.pipe(
    z.number({ error: `${etiqueta} debe ser un número.` }).min(0, `${etiqueta} no puede ser negativo.`),
  );

const numeroCualquiera = (etiqueta: string) =>
  numeroDeTexto.pipe(z.number({ error: `${etiqueta} debe ser un número.` }));

export const tipoContratoEsquema = z.enum([
  "precio_fijo_usd",
  "por_fijar_ny",
  "sin_contrato",
]);

const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato aaaa-mm-dd.");

/** Alta de un lote de inventario. */
export const esquemaLote = z
  .object({
    nombre: z.string().trim().min(1, "Póngale un nombre al lote.").max(120),
    toneladas: numeroPositivo("Las toneladas"),
    costoCopKg: numeroNoNegativo("El costo por kilo"),
    ubicacion: z.string().trim().min(1, "Indique la ubicación de la bodega.").max(120),
    fechaEmbarque: fechaIso,
    diferencialUsdTm: numeroCualquiera("El diferencial"),
    tipoContrato: tipoContratoEsquema,
    precioVentaUsdTm: z.string().trim().optional(),
    mesFuturo: z
      .string()
      .trim()
      .regex(/^[HKNUZ][0-9]{2}$/i, "Use un código como Z26 (mes H, K, N, U o Z + año).")
      .optional()
      .or(z.literal("")),
    notas: z.string().trim().max(2000).optional(),
  })
  .superRefine((datos, ctx) => {
    // Un contrato a precio fijo sin precio no es un contrato a precio fijo.
    if (datos.tipoContrato === "precio_fijo_usd") {
      const precio = Number(String(datos.precioVentaUsdTm ?? "").replace(",", "."));
      if (!Number.isFinite(precio) || precio <= 0) {
        ctx.addIssue({
          code: "custom",
          path: ["precioVentaUsdTm"],
          message: "Un contrato a precio fijo necesita el precio pactado en USD/TM.",
        });
      }
    }
  });

export type DatosLote = z.infer<typeof esquemaLote>;

/**
 * Parámetros de un análisis.
 *
 * `ratioCobertura` vacío significa "recomiéndame": el motor compara todas
 * las estrategias y elige por el percentil 5.
 */
export const esquemaAnalisis = z.object({
  inventarioId: z.uuid().optional().or(z.literal("")),
  toneladas: numeroPositivo("Las toneladas"),
  costoCopKg: numeroNoNegativo("El costo por kilo"),
  fechaEmbarque: fechaIso,
  diferencialUsdTm: numeroCualquiera("El diferencial"),
  tipoContrato: tipoContratoEsquema,
  precioVentaUsdTm: z.string().trim().optional(),
  /** "simbolo|fuente" de la serie de cacao. Vacío = fuente en vivo. */
  origenCacao: z.string().trim().optional(),
});

export type DatosAnalisis = z.infer<typeof esquemaAnalisis>;

/** Aplana los errores de Zod a `{ campo: mensaje }` para pintarlos junto al input. */
export function erroresPorCampo(error: z.ZodError): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const incidencia of error.issues) {
    const campo = incidencia.path.join(".") || "_";
    salida[campo] ??= incidencia.message;
  }
  return salida;
}
