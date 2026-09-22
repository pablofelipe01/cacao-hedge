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
import { margenMantenimientoDesdeInicial } from "@/lib/engine/constantes";
import {
  SUPUESTOS_POR_DEFECTO,
  type Lote,
  type Supuestos,
  type TipoOperacion,
} from "@/lib/engine/tipos";
import { descuentoVigente } from "@/lib/data/descuento-productor";
import { diasHasta } from "@/lib/formato";

import { erroresPorCampo, esquemaAnalisis, interpretarNumero } from "./esquemas";
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
      // Del inicial y no de la columna: las filas guardadas antes de que se
      // derivara conservan el 7.200 por defecto que nadie confirmó.
      margenMantenimientoUsd: margenMantenimientoDesdeInicial(Number(data.margen_inicial_usd)),
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

  // El sentido de la cobertura sale de la situación declarada, no del
  // tipo de contrato: quien ya vendió y debe comprar el físico necesita
  // COMPRAR futuros, y confundirlo duplicaría su exposición.
  const tipoOperacion: TipoOperacion =
    datos.situacion === "ya_vendi" ? "venta_sin_comprar" : "inventario_sin_vender";

  const precio = interpretarNumero(String(datos.precioVentaUsdTm ?? ""));
  // Una venta cerrada siempre tiene precio; el esquema ya lo exigió.
  const necesitaPrecio =
    tipoOperacion === "venta_sin_comprar" || datos.tipoContrato === "precio_fijo_usd";

  // El porcentaje llega como 23,5 y el motor lo quiere como fracción.
  const esPorcentual = datos.modoDiferencial === "porcentual";

  const lote: Lote = {
    toneladas: datos.toneladas,
    // El cacao del caso A todavía no se compró: no hay costo hundido.
    costoCopKg: tipoOperacion === "venta_sin_comprar" ? 0 : datos.costoCopKg,
    diasAEmbarque: dias,
    diferencialUsdTm: esPorcentual ? 0 : datos.diferencialUsdTm,
    diferencialPorcentual: esPorcentual ? datos.diferencialUsdTm / 100 : null,
    tipoOperacion,
    tipoContrato: datos.tipoContrato,
    precioVentaUsdTm: necesitaPrecio && Number.isFinite(precio) ? precio : null,
  };

  if (necesitaPrecio && lote.precioVentaUsdTm == null) {
    return {
      errores: {
        precioVentaUsdTm:
          tipoOperacion === "venta_sin_comprar"
            ? "Indique a qué precio cerró la venta, en USD/TM."
            : "Un contrato a precio fijo necesita el precio pactado.",
      },
    };
  }

  const supabase = await crearClienteServidor();
  const { supuestos: supuestosBase, volRespaldo } = await supuestosDelUsuario(usuario.id);

  // El riesgo de base medido con SUS datos, si sincronizó la hoja de
  // precios. Es el único riesgo que la cobertura con futuros no toca, y
  // el valor por defecto —medido sobre otro periodo— es solo un respaldo.
  const medido = await descuentoVigente(supabase, usuario.id).catch(() => null);
  const supuestos =
    medido && medido.resumen.desviacion > 0
      ? { ...supuestosBase, desviacionBaseFraccion: medido.resumen.desviacion }
      : supuestosBase;

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
        operacion: resultado.operacion,
        aniosHorizonte: resultado.aniosHorizonte,
        precioEquilibrioUsdTm: resultado.precioEquilibrioUsdTm,
        dimensionamiento: resultado.dimensionamiento,
        evaluaciones: resultado.evaluaciones,
        recomendacion: resultado.recomendacion,
        cambiario: resultado.cambiario,
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
