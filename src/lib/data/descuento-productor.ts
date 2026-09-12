/**
 * El descuento vigente del precio al productor contra Nueva York.
 *
 * Junta tres series que viven en sitios distintos —el precio publicado
 * por Nacional y Luker, el futuro CC y la TRM oficial— y devuelve la
 * distancia entre el primero y los otros dos.
 *
 * Existe para sustituir un número de memoria por uno medido. El
 * exportador sabía que compra «22 a 25 % por debajo de Nueva York», y
 * sobre dos años de datos la media resultó ser 23,0 %: la memoria era
 * buena. Lo que la memoria no tenía es que ese descuento oscila entre
 * 15 % y 32 %, y que el día en que se hizo esta medición estaba en el
 * extremo caro. Escribir 23,5 % ese día subestimaba el costo en unos
 * 458 USD/TM.
 */

import { leerSerieCache, type ClienteSupabase } from "./cache";
import { SIMBOLO_TRM } from "@/lib/engine/constantes";
import type { FuentePrecio } from "@/types/database";
import {
  calcularDescuentos,
  resumirDescuento,
  type Comprador,
  type DescuentoObservado,
  type ResumenDescuento,
} from "./hoja-precios-productor";

/** Comprador que se toma como referencia cuando el usuario no elige. */
export const COMPRADOR_POR_DEFECTO: Comprador = "luker_bajo_cadmio";

export interface DescuentoVigente {
  resumen: ResumenDescuento;
  /** Serie completa, para graficar la distribución. */
  observados: DescuentoObservado[];
  /** Serie de cacao con la que se cruzó. */
  simboloCacao: string;
}

/**
 * Calcula el descuento observado a partir de lo que hay en la base.
 *
 * Devuelve null en vez de lanzar cuando falta alguna de las tres series:
 * un análisis sin este dato sigue siendo posible —el usuario escribe el
 * diferencial a mano, como antes—, y bloquear la pantalla por no poder
 * ofrecer una comodidad sería peor que no ofrecerla.
 */
export async function descuentoVigente(
  cliente: ClienteSupabase,
  userId: string,
  opciones: { comprador?: Comprador; serieCacao?: SerieCacao } = {},
): Promise<DescuentoVigente | null> {
  const comprador = opciones.comprador ?? COMPRADOR_POR_DEFECTO;

  const { data: filas, error } = await cliente
    .from("precios_productor")
    .select("fecha, precio_cop_kg")
    .eq("user_id", userId)
    .eq("comprador", comprador)
    .order("fecha", { ascending: true })
    .limit(2000);

  if (error || !filas || filas.length === 0) return null;

  const desde = filas[0].fecha;
  const hasta = filas[filas.length - 1].fecha;

  // La serie de cacao puede venir de varias fuentes; se busca la que
  // tenga más solapamiento con el precio del productor, porque el cruce
  // vale exactamente lo que valga el número de días comunes.
  const simbolo = opciones.serieCacao ?? (await simboloConMasSolape(cliente, desde, hasta));
  if (!simbolo) return null;

  const [cacao, trm] = await Promise.all([
    leerSerieCache(cliente, simbolo.simbolo, simbolo.fuente, desde, hasta),
    leerSerieCache(cliente, SIMBOLO_TRM, "manual", desde, hasta).catch(() => []),
  ]);

  const trmFinal = trm.length > 0 ? trm : await trmDeCualquierFuente(cliente, desde, hasta);
  if (cacao.length === 0 || trmFinal.length === 0) return null;

  const observados = calcularDescuentos(
    filas.map((f) => ({
      fecha: f.fecha,
      comprador,
      precioCopKg: Number(f.precio_cop_kg),
    })),
    new Map(cacao.map((b) => [b.fecha, b.cierre])),
    new Map(trmFinal.map((b) => [b.fecha, b.cierre])),
  );

  const resumen = resumirDescuento(observados, comprador);
  if (!resumen) return null;

  return { resumen, observados, simboloCacao: simbolo.simbolo };
}

/** Una serie de cacao concreta de la caché. */
export interface SerieCacao {
  simbolo: string;
  fuente: FuentePrecio;
}

/** La serie de cacao cacheada con más días dentro del rango pedido. */
async function simboloConMasSolape(
  cliente: ClienteSupabase,
  desde: string,
  hasta: string,
): Promise<SerieCacao | null> {
  const { data } = await cliente
    .from("precios")
    .select("simbolo, fuente")
    .neq("simbolo", SIMBOLO_TRM)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .limit(5000);

  if (!data || data.length === 0) return null;

  const cuenta = new Map<string, number>();
  for (const f of data) {
    const clave = `${f.simbolo}|${f.fuente}`;
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  }

  const [mejor] = [...cuenta.entries()].sort((a, b) => b[1] - a[1]);
  if (!mejor) return null;

  const [simbolo, fuente] = mejor[0].split("|");
  return { simbolo, fuente: fuente as FuentePrecio };
}

/** La TRM se cachea con distintas fuentes según cómo se haya sembrado. */
async function trmDeCualquierFuente(
  cliente: ClienteSupabase,
  desde: string,
  hasta: string,
): Promise<{ fecha: string; cierre: number }[]> {
  const { data } = await cliente
    .from("precios")
    .select("fecha, cierre")
    .eq("simbolo", SIMBOLO_TRM)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: true })
    .limit(2000);

  return (data ?? []).map((f) => ({ fecha: f.fecha, cierre: Number(f.cierre) }));
}
