"use server";

import { revalidatePath } from "next/cache";

import { hayClaveServiceRole } from "@/lib/env";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { obtenerUsuario } from "@/lib/supabase/server";
import { guardarSerieCache } from "@/lib/data/cache";
import { importarCsv, simboloDesdeNombreArchivo } from "@/lib/data/csv";
import { ErrorDatos } from "@/lib/data/errores";
import type { TipoSerie } from "@/types/database";

export type EstadoImportacion = {
  mensaje?: string;
  error?: string;
  detalle?: { barras: number; desde: string; hasta: string; simbolo: string; descartadas: number };
};

/** Tamaño máximo del archivo. Un histórico de 10 años ronda los 200 kB. */
const MAXIMO_BYTES = 5 * 1024 * 1024;

/**
 * Importa un histórico en CSV a la caché de precios.
 *
 * Es la vía que sí permite una cuenta estándar de barchart.com: descargar
 * el histórico desde la web y subirlo aquí. Evita depender del límite de
 * peticiones de Yahoo y no requiere la API OnDemand.
 */
export async function importarHistorico(
  _estado: EstadoImportacion,
  formData: FormData,
): Promise<EstadoImportacion> {
  const usuario = await obtenerUsuario();
  if (!usuario) return { error: "Debe iniciar sesión." };

  if (!hayClaveServiceRole()) {
    return {
      error:
        "La caché de precios solo se puede escribir con la SUPABASE_SERVICE_ROLE_KEY configurada en el servidor.",
    };
  }

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Seleccione un archivo CSV." };
  }
  if (archivo.size > MAXIMO_BYTES) {
    return { error: "El archivo supera los 5 MB. Exporte un rango de fechas más corto." };
  }

  // Prioridad del símbolo: lo que escriba el usuario, luego el nombre del
  // archivo (el export de Barchart lo lleva ahí), y por último el valor
  // por defecto. La columna `Symbol` del CSV, si existe, gana sobre todos
  // dentro de `importarCsv`.
  const simbolo =
    String(formData.get("simbolo") ?? "").trim() ||
    simboloDesdeNombreArchivo(archivo.name) ||
    "CC=F";
  const serie = (String(formData.get("serie") ?? "CC") as TipoSerie) satisfies TipoSerie;

  try {
    const resultado = importarCsv(await archivo.text(), simbolo, serie);
    const guardadas = await guardarSerieCache(crearClienteAdmin(), resultado);

    revalidatePath("/importar");
    return {
      mensaje: `Se importaron ${guardadas} barras de ${resultado.simbolo}.`,
      detalle: {
        barras: guardadas,
        desde: resultado.barras[0].fecha,
        hasta: resultado.barras.at(-1)!.fecha,
        simbolo: resultado.simbolo,
        descartadas: resultado.filasDescartadas,
      },
    };
  } catch (error) {
    if (error instanceof ErrorDatos) return { error: error.mensajeUsuario };
    return { error: "No se pudo interpretar el archivo." };
  }
}
