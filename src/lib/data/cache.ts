/**
 * Caché de series en la tabla compartida `precios`.
 *
 * Objetivos: no golpear las APIs externas en cada análisis y, sobre todo,
 * que un análisis se pueda reproducir aunque la fuente original cambie o
 * desaparezca.
 *
 * La tabla tiene RLS con lectura para autenticados y escritura reservada
 * a `service_role`, así que las funciones de escritura exigen el cliente
 * administrador y solo deben invocarse desde el servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, FuentePrecio, TipoSerie } from "@/types/database";
import { ErrorDatos } from "./errores";
import type { Barra, SerieHistorica } from "./tipos";

type ClienteSupabase = SupabaseClient<Database>;

/** Tamaño de lote para el upsert: evita payloads enormes en una sola llamada. */
const TAMANIO_LOTE = 500;

/**
 * Lee de la caché las barras de un símbolo y una fuente dentro de un rango.
 *
 * Filtrar por fuente no es opcional: la restricción única de la tabla es
 * (simbolo, fecha, fuente), así que el mismo símbolo puede tener filas de
 * Yahoo y de un CSV importado a la vez. Mezclarlas produciría una serie
 * con saltos de precio inventados —el continuo y un vencimiento concreto
 * cotizan distinto— y el análisis guardado declararía una procedencia que
 * no corresponde a los datos que usó.
 */
export async function leerSerieCache(
  cliente: ClienteSupabase,
  simbolo: string,
  fuente: FuentePrecio,
  desde: string,
  hasta: string,
): Promise<Barra[]> {
  const { data, error } = await cliente
    .from("precios")
    .select("fecha, apertura, maximo, minimo, cierre, volumen")
    .eq("simbolo", simbolo)
    .eq("fuente", fuente)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: true });

  if (error) {
    throw new ErrorDatos("Caché de precios", "respuesta_invalida", `No se pudo leer la caché: ${error.message}`);
  }

  return (data ?? []).map((fila) => ({
    fecha: fila.fecha,
    apertura: fila.apertura,
    maximo: fila.maximo,
    minimo: fila.minimo,
    cierre: fila.cierre,
    volumen: fila.volumen,
  }));
}

/** Última barra cacheada de un símbolo y fuente, o null si no hay ninguna. */
export async function ultimaBarraCache(
  cliente: ClienteSupabase,
  simbolo: string,
  fuente: FuentePrecio,
): Promise<Barra | null> {
  const { data, error } = await cliente
    .from("precios")
    .select("fecha, apertura, maximo, minimo, cierre, volumen")
    .eq("simbolo", simbolo)
    .eq("fuente", fuente)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ErrorDatos("Caché de precios", "respuesta_invalida", `No se pudo leer la caché: ${error.message}`);
  }

  return data
    ? {
        fecha: data.fecha,
        apertura: data.apertura,
        maximo: data.maximo,
        minimo: data.minimo,
        cierre: data.cierre,
        volumen: data.volumen,
      }
    : null;
}

/**
 * Guarda una serie en la caché.
 *
 * Usa upsert sobre la restricción única (simbolo, fecha, fuente): reescribir
 * una serie solapada actualiza las filas existentes en vez de duplicarlas,
 * que es justo lo que hace falta al refrescar los últimos días.
 *
 * Requiere el cliente `service_role`: con la anon key, RLS rechaza la escritura.
 */
export async function guardarSerieCache(
  clienteAdmin: ClienteSupabase,
  serie: SerieHistorica,
): Promise<number> {
  const filas = serie.barras.map((barra) => ({
    serie: serie.serie,
    simbolo: serie.simbolo,
    fecha: barra.fecha,
    apertura: barra.apertura,
    maximo: barra.maximo,
    minimo: barra.minimo,
    cierre: barra.cierre,
    volumen: barra.volumen,
    fuente: serie.fuente,
  }));

  let guardadas = 0;

  for (let i = 0; i < filas.length; i += TAMANIO_LOTE) {
    const lote = filas.slice(i, i + TAMANIO_LOTE);
    const { error } = await clienteAdmin
      .from("precios")
      .upsert(lote, { onConflict: "simbolo,fecha,fuente" });

    if (error) {
      throw new ErrorDatos(
        "Caché de precios",
        error.code === "42501" ? "no_autorizado" : "respuesta_invalida",
        error.code === "42501"
          ? "La escritura en la caché de precios exige la SUPABASE_SERVICE_ROLE_KEY."
          : `No se pudo escribir la caché: ${error.message}`,
      );
    }

    guardadas += lote.length;
  }

  return guardadas;
}

export interface ResultadoConCache extends SerieHistorica {
  /** true si los datos salieron de la caché sin consultar la fuente externa. */
  desdeCache: boolean;
  /** Barras nuevas escritas en la caché en esta llamada. */
  barrasGuardadas: number;
}

export interface OpcionesConCache {
  cliente: ClienteSupabase;
  /** Cliente con service_role. Sin él, la serie se sirve pero no se cachea. */
  clienteAdmin?: ClienteSupabase;
  serie: TipoSerie;
  simbolo: string;
  fuente: FuentePrecio;
  desde: string;
  hasta: string;
  /** Mínimo de barras para dar por buena la caché y no consultar la fuente. */
  minimoBarras?: number;
  /** Cuántos días de antigüedad se toleran en la última barra cacheada. */
  frescuraDias?: number;
  /** Trae la serie de la fuente externa. Solo se llama si la caché no sirve. */
  traerDeFuente: () => Promise<SerieHistorica>;
}

/**
 * Sirve una serie desde la caché y solo consulta la fuente externa si hace
 * falta: faltan barras o las que hay están viejas.
 *
 * Si la fuente externa falla pero la caché tiene algo utilizable, devuelve
 * lo cacheado en vez de tumbar el análisis. Un dato de ayer es mucho más
 * útil que un error.
 */
export async function obtenerSerieConCache(
  opciones: OpcionesConCache,
): Promise<ResultadoConCache> {
  const {
    cliente,
    clienteAdmin,
    serie,
    simbolo,
    fuente,
    desde,
    hasta,
    minimoBarras = 20,
    frescuraDias = 3,
    traerDeFuente,
  } = opciones;

  const cacheadas = await leerSerieCache(cliente, simbolo, fuente, desde, hasta);
  const ultima = cacheadas.at(-1);

  const diasDesdeUltima = ultima
    ? Math.round(
        (new Date(`${hasta}T00:00:00Z`).getTime() -
          new Date(`${ultima.fecha}T00:00:00Z`).getTime()) /
          86_400_000,
      )
    : Number.POSITIVE_INFINITY;

  const cacheSirve = cacheadas.length >= minimoBarras && diasDesdeUltima <= frescuraDias;

  if (cacheSirve) {
    return { serie, simbolo, fuente, barras: cacheadas, desdeCache: true, barrasGuardadas: 0 };
  }

  try {
    const fresca = await traerDeFuente();
    const barrasGuardadas = clienteAdmin ? await guardarSerieCache(clienteAdmin, fresca) : 0;
    return { ...fresca, desdeCache: false, barrasGuardadas };
  } catch (error) {
    // Degradación elegante: preferimos datos viejos a ningún dato.
    if (cacheadas.length > 0) {
      return { serie, simbolo, fuente, barras: cacheadas, desdeCache: true, barrasGuardadas: 0 };
    }
    throw error;
  }
}

export interface SerieDisponible {
  simbolo: string;
  fuente: FuentePrecio;
  barras: number;
  primera: string;
  ultima: string;
}

/**
 * Series de cacao que hay en la caché, para que el usuario elija contra
 * qué contrato analizar.
 *
 * Lee de la vista `series_precios`, que agrega en Postgres. Contar en el
 * cliente exigía traerse todas las filas y PostgREST corta en 1.000: los
 * conteos salían truncados y una serie entera podía no aparecer.
 */
export async function seriesDisponibles(
  cliente: ClienteSupabase,
  serie: TipoSerie = "CC",
): Promise<SerieDisponible[]> {
  const { data, error } = await cliente
    .from("series_precios")
    .select("simbolo, fuente, barras, primera, ultima")
    .eq("serie", serie)
    // Con datos más recientes primero: es la candidata natural.
    .order("ultima", { ascending: false });

  if (error) {
    throw new ErrorDatos(
      "Caché de precios",
      "respuesta_invalida",
      `No se pudieron listar las series: ${error.message}`,
    );
  }

  return data ?? [];
}
