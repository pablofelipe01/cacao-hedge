/**
 * Esquemas de validación de los formularios.
 *
 * Se validan en el servidor porque el navegador no es una frontera de
 * confianza: los `required` y `min` del HTML son ayudas de usabilidad,
 * no garantías.
 */

import { z } from "zod";

/**
 * Convierte una cadena de formulario a número resolviendo la ambigüedad
 * del punto, que en Colombia separa miles y en inglés decimales.
 *
 * Hace falta porque el formulario mezcla ambas convenciones sin querer:
 * el usuario escribe «14.500» pensando en catorce mil quinientos, pero el
 * navegador rellena los valores por defecto con el punto decimal de
 * JavaScript («4.25»). Tratar todo punto como separador de miles convertía
 * una tasa del 4,25 % en 425 % y hacía fallar el formulario sin que el
 * usuario hubiera tocado nada.
 *
 * Reglas, en orden:
 *   1. Si hay punto y coma, manda el último: es el decimal.
 *   2. Solo coma: es el decimal.
 *   3. Solo punto: separa miles si va seguido de exactamente tres cifras
 *      (14.500); en cualquier otro caso es decimal (4.25).
 */
export function interpretarNumero(entrada: string): number {
  // El menos tipográfico (−, U+2212) es lo que producen iOS y macOS con
  // sustitución automática, y es visualmente idéntico al guion: si no se
  // normaliza, «−300» se rechaza sin que el usuario vea por qué.
  const valor = entrada.trim().replace(/\s/g, "").replace(/[\u2212\u2012-\u2015]/g, "-");
  if (valor === "") return Number.NaN;

  const ultimoPunto = valor.lastIndexOf(".");
  const ultimaComa = valor.lastIndexOf(",");

  if (ultimoPunto !== -1 && ultimaComa !== -1) {
    return ultimaComa > ultimoPunto
      ? Number(valor.replace(/\./g, "").replace(",", "."))
      : Number(valor.replace(/,/g, ""));
  }

  if (ultimaComa !== -1) return Number(valor.replace(/\./g, "").replace(",", "."));

  if (ultimoPunto !== -1) {
    const esMiles = /^-?\d{1,3}(?:\.\d{3})+$/.test(valor);
    return Number(esMiles ? valor.replace(/\./g, "") : valor);
  }

  return Number(valor);
}

const numeroDeTexto = z.string().trim().transform(interpretarNumero);

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

/**
 * Los dos casos de cobertura.
 *
 * - `tengo_cacao` (caso B): hay inventario físico sin vender. El riesgo
 *   es que el precio BAJE y la cobertura es VENDER futuros.
 * - `ya_vendi` (caso A): hay una venta cerrada y falta comprar el
 *   físico. El riesgo es que el precio SUBA y la cobertura es COMPRAR
 *   futuros.
 *
 * El sentido de la cobertura sale de aquí y de ningún otro lado: si este
 * campo llega mal, el motor recomendará vender futuros a quien necesita
 * comprarlos y duplicará su exposición en vez de cubrirla.
 */
export const situacionEsquema = z.enum(["tengo_cacao", "ya_vendi"]);

/**
 * Cómo se pactó el diferencial.
 *
 * - `absoluto`: una cantidad fija en USD/TM que no cambia hasta la
 *   entrega. El precio del físico se mueve dólar por dólar con la bolsa.
 * - `porcentual`: un porcentaje del cierre de Nueva York del día de la
 *   compra, que es como se pacta el cacao en Colombia. El precio del
 *   físico se mueve solo (1 + p) por cada dólar de la bolsa, así que la
 *   exposición —y la cobertura que hace falta— es menor.
 */
export const modoDiferencialEsquema = z.enum(["absoluto", "porcentual"]);

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
export const esquemaAnalisis = z
  .object({
    situacion: situacionEsquema.default("tengo_cacao"),
    inventarioId: z.uuid().optional().or(z.literal("")),
    toneladas: numeroPositivo("Las toneladas"),
    // En el caso A el cacao todavía no se ha comprado: no hay costo
    // hundido que declarar, y el formulario no pinta el campo.
    costoCopKg: z
      .string()
      .trim()
      .default("0")
      .transform(interpretarNumero)
      .pipe(z.number({ error: "El costo por kilo debe ser un número." }).min(0, "El costo por kilo no puede ser negativo.")),
    fechaEmbarque: fechaIso,
    diferencialUsdTm: numeroCualquiera("El diferencial"),
    modoDiferencial: modoDiferencialEsquema.default("absoluto"),
    tipoContrato: tipoContratoEsquema,
    precioVentaUsdTm: z.string().trim().optional(),
    /** "simbolo|fuente" de la serie de cacao. Vacío = fuente en vivo. */
    origenCacao: z.string().trim().optional(),
  })
  .superRefine((datos, ctx) => {
    // El precio pactado es obligatorio en dos situaciones distintas: un
    // contrato a precio fijo (caso B) y una venta ya cerrada (caso A).
    // En el caso A además es el número que sostiene todo el análisis: sin
    // él no hay ingreso contra el cual medir el costo de abastecerse.
    const exigePrecio =
      datos.situacion === "ya_vendi" || datos.tipoContrato === "precio_fijo_usd";
    if (!exigePrecio) return;

    const precio = interpretarNumero(String(datos.precioVentaUsdTm ?? ""));
    if (Number.isFinite(precio) && precio > 0) return;

    ctx.addIssue({
      code: "custom",
      path: ["precioVentaUsdTm"],
      message:
        datos.situacion === "ya_vendi"
          ? "Indique a qué precio cerró la venta, en USD/TM."
          : "Un contrato a precio fijo necesita el precio pactado en USD/TM.",
    });
  })
  .superRefine((datos, ctx) => {
    // Un porcentaje fuera de ±100 no es un diferencial: es un número mal
    // tecleado, y dejarlo pasar produciría un precio físico negativo.
    if (datos.modoDiferencial !== "porcentual") return;
    if (Math.abs(datos.diferencialUsdTm) < 100) return;

    ctx.addIssue({
      code: "custom",
      path: ["diferencialUsdTm"],
      message:
        "Como porcentaje debe estar entre −100 y 100. Si quería escribir dólares por tonelada, cambie la unidad al lado del campo.",
    });
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

/**
 * Supuestos de cálculo del usuario.
 *
 * Los rangos no son caprichosos: replican los CHECK de la tabla, para que
 * un valor imposible se rechace con un mensaje entendible aquí en vez de
 * reventar contra una restricción de Postgres.
 */
export const esquemaConfiguracion = z
  .object({
    margenInicialUsd: numeroPositivo("El margen inicial"),
    comisionUsdContrato: numeroNoNegativo("La comisión"),
    tasaLibreRiesgoPorcentaje: numeroDeTexto.pipe(
      z.number().min(0, "La tasa no puede ser negativa.").max(50, "Una tasa por encima del 50 % anual no es plausible."),
    ),
    volFallbackPorcentaje: numeroDeTexto.pipe(
      z.number().gt(0, "La volatilidad de respaldo debe ser mayor que cero.").max(300, "Una volatilidad por encima del 300 % no es plausible."),
    ),
    diasHabilesAnio: numeroDeTexto.pipe(
      z.number().int("Debe ser un número entero.").min(200).max(366),
    ),
    nivelConfianzaVarPorcentaje: numeroDeTexto.pipe(
      z.number().gt(50, "El nivel de confianza debe superar el 50 %.").lt(100, "El nivel de confianza no puede llegar al 100 %."),
    ),
    trayectoriasMc: numeroDeTexto.pipe(
      z.number().int("Debe ser un número entero.").min(1000, "Con menos de 1.000 trayectorias la simulación es ruido.").max(200000, "Más de 200.000 trayectorias no mejora el resultado y tarda demasiado."),
    ),
  });

export type DatosConfiguracion = z.infer<typeof esquemaConfiguracion>;
