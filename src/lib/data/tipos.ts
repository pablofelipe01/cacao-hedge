/**
 * Capa de datos de mercado: contratos comunes a todos los proveedores.
 *
 * La aplicación nunca habla con Yahoo ni con Barchart directamente: habla
 * con `PriceProvider`. Eso permite que el sistema funcione completo con el
 * respaldo gratuito y que cambiar de fuente sea sustituir una clase.
 */

import type { FuentePrecio, TipoSerie } from "@/types/database";

/** Una observación diaria OHLC. `fecha` es ISO `yyyy-mm-dd`. */
export interface Barra {
  fecha: string;
  apertura: number | null;
  maximo: number | null;
  minimo: number | null;
  cierre: number;
  volumen: number | null;
}

/** Serie histórica normalizada, en orden cronológico ascendente. */
export interface SerieHistorica {
  serie: TipoSerie;
  simbolo: string;
  fuente: FuentePrecio;
  barras: Barra[];
}

/** Último precio conocido de un instrumento. */
export interface Cotizacion {
  serie: TipoSerie;
  simbolo: string;
  fuente: FuentePrecio;
  precio: number;
  fecha: string;
  /** Nombre legible del contrato, p. ej. "Cocoa Dec 26". */
  descripcion?: string;
  moneda?: string;
}

export interface OpcionesHistorico {
  /** Símbolo a consultar. Cada proveedor tiene su propio valor por defecto. */
  simbolo?: string;
  /** Fecha inicial inclusive, ISO `yyyy-mm-dd`. */
  desde: string;
  /** Fecha final inclusive. Por defecto, hoy. */
  hasta?: string;
}

/**
 * Fuente de precios intercambiable.
 *
 * `disponible()` permite que el orquestador degrade a otro proveedor sin
 * lanzar excepciones: un Barchart sin API key simplemente no está
 * disponible, no es un error.
 */
export interface PriceProvider {
  readonly nombre: string;
  readonly fuente: FuentePrecio;
  /** false si al proveedor le faltan credenciales o configuración. */
  disponible(): boolean;
  /** Motivo legible cuando `disponible()` es false. */
  motivoNoDisponible?(): string;
  cotizacion(simbolo?: string): Promise<Cotizacion>;
  historico(opciones: OpcionesHistorico): Promise<SerieHistorica>;
}
