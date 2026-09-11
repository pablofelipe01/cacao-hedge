"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { envDatosMercado, hayClaveServiceRole } from "@/lib/env";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { ErrorDatos } from "@/lib/data/errores";
import { elegirProveedor, obtenerMercado, type OrigenCacao } from "@/lib/data/mercado";
import type { FuentePrecio } from "@/types/database";
import { analizarCobertura } from "@/lib/engine/index";
import { SUPUESTOS_POR_DEFECTO, type Lote, type Supuestos } from "@/lib/engine/tipos";
import { diasHasta } from "@/lib/formato";

import { erroresPorCampo, esquemaAnalisis } from "./esquemas";
import type { EstadoFormulario } from "./inventario";
import type { Json } from "@/types/database";

/**
 * Serializa un objeto al tipo `Json` de la base.
 *
 * El viaje por JSON no es ceremonia de tipos: es exactamente la
 * transformación que aplicará Postgres al guardar en jsonb —descarta
 * `undefined`, funciones y prototipos—, así que hacerla aquí garantiza
 * que lo que se guarda es idéntico a lo que se lee de vuelta.
 */
function aJson<T>(valor: T): Json {
  return JSON.parse(JSON.stringify(valor)) as Json;
}

/**
 * Supuestos del usuario más la volatilidad de respaldo, que no forma
 * parte de `Supuestos` porque no la consume el motor sino la capa de
 * datos: solo se usa cuando la serie histórica no alcanza.
 */
interface SupuestosCompletos {
  supuestos: Supuestos;
  volRespaldo: number;
}

/** Lee los supuestos del usuario, cayendo a los valores por defecto. */
async function supuestosDelUsuario(userId: string): Promise<SupuestosCompletos> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("configuracion")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { supuestos: SUPUESTOS_POR_DEFECTO, volRespaldo: 0.35 };

  return {
    supuestos: {
      ...SUPUESTOS_POR_DEFECTO,
      margenInicialUsd: Number(data.margen_inicial_usd),
      margenMantenimientoUsd: Number(data.margen_mantenimiento_usd),
      comisionUsdContrato: Number(data.comision_usd_contrato),
      tasaLibreRiesgo: Number(data.tasa_libre_riesgo),
      diasHabilesAnio: data.dias_habiles_anio,
      nivelConfianzaVar: Number(data.nivel_confianza_var),
      trayectoriasMc: data.trayectorias_mc,
    },
    volRespaldo: Number(data.vol_fallback),
  };
}

/**
 * Ejecuta el análisis completo y lo persiste.
 *
 * El orden importa: primero se traen los datos de mercado, luego calcula
 * el motor y al final se guarda TODO junto —entradas, mercado, supuestos
 * y resultados—. Guardar la fotografía completa es lo que permite volver
 * a abrir el análisis meses después y que las cifras sigan cuadrando,
 * aunque el precio de hoy ya no tenga nada que ver.
 */
export async function ejecutarAnalisis(
  _estado: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  const usuario = await obtenerUsuario();
  if (!usuario) redirect("/login");

  const validado = esquemaAnalisis.safeParse(Object.fromEntries(formData));
  if (!validado.success) {
    return { errores: erroresPorCampo(validado.error) };
  }

  const datos = validado.data;
  const dias = diasHasta(datos.fechaEmbarque);
  if (dias <= 0) {
    return { errores: { fechaEmbarque: "La fecha de embarque debe ser futura." } };
  }

  const precio = Number(String(datos.precioVentaUsdTm ?? "").replace(",", "."));
  const lote: Lote = {
    toneladas: datos.toneladas,
    costoCopKg: datos.costoCopKg,
    diasAEmbarque: dias,
    diferencialUsdTm: datos.diferencialUsdTm,
    tipoContrato: datos.tipoContrato,
    precioVentaUsdTm:
      datos.tipoContrato === "precio_fijo_usd" && Number.isFinite(precio) ? precio : null,
  };

  if (lote.tipoContrato === "precio_fijo_usd" && lote.precioVentaUsdTm == null) {
    return {
      errores: { precioVentaUsdTm: "Un contrato a precio fijo necesita el precio pactado." },
    };
  }

  const supabase = await crearClienteServidor();
  const { supuestos, volRespaldo } = await supuestosDelUsuario(usuario.id);

  // El selector envía "simbolo|fuente"; vacío significa la fuente en vivo.
  let origenCacao: OrigenCacao | undefined;
  if (datos.origenCacao) {
    const [simbolo, fuente] = datos.origenCacao.split("|");
    if (simbolo && fuente) origenCacao = { simbolo, fuente: fuente as FuentePrecio };
  }

  let mercado;
  try {
    const { barchartApiKey, trmEndpoint, socrataAppToken } = envDatosMercado();
    mercado = await obtenerMercado({
      cliente: supabase,
      clienteAdmin: hayClaveServiceRole() ? crearClienteAdmin() : undefined,
      proveedor: elegirProveedor(barchartApiKey),
      origenCacao,
      opcionesTrm: { endpoint: trmEndpoint, appToken: socrataAppToken },
      volCacaoRespaldo: volRespaldo,
    });
  } catch (error) {
    return {
      mensaje:
        error instanceof ErrorDatos
          ? error.mensajeUsuario
          : "No se pudieron obtener los datos de mercado.",
    };
  }

  const resultado = analizarCobertura(lote, mercado.mercado, supuestos);

  const { data, error } = await supabase
    .from("analisis")
    .insert({
      user_id: usuario.id,
      inventario_id: datos.inventarioId || null,
      estado: "calculado",
      entradas: aJson({ ...datos, diasAEmbarque: dias }),
      mercado: aJson({ ...mercado.mercado, procedencia: mercado.procedencia }),
      supuestos: aJson(supuestos),
      resultados: aJson({
        // `lote`, `mercado` y `supuestos` ya viven en sus propias columnas:
        // repetirlos aquí solo engordaría el jsonb.
        aniosHorizonte: resultado.aniosHorizonte,
        precioEquilibrioUsdTm: resultado.precioEquilibrioUsdTm,
        dimensionamiento: resultado.dimensionamiento,
        evaluaciones: resultado.evaluaciones,
        recomendacion: resultado.recomendacion,
        advertencias: resultado.advertencias,
        advertenciasDatos: mercado.advertencias,
      }),
    })
    .select("id")
    .single();

  if (error) {
    return { mensaje: `El cálculo salió bien pero no se pudo guardar: ${error.message}` };
  }

  revalidatePath("/dashboard");
  redirect(`/analisis/${data.id}`);
}
