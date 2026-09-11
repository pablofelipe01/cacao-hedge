/**
 * Tipos del motor de cálculo.
 *
 * Todo el motor es TypeScript puro: sin I/O, sin fechas del sistema, sin
 * aleatoriedad no sembrada. Las mismas entradas producen siempre las
 * mismas salidas, que es lo que permite testearlo y reproducir un
 * análisis guardado meses después.
 *
 * Convenciones de unidades, respetadas en todo el motor:
 *   - Precios de cacao:     USD por tonelada métrica  (USD/TM)
 *   - Diferencial / base:   USD/TM  (positivo = prima, negativo = descuento)
 *   - TRM:                  COP por USD
 *   - Costo de adquisición: COP por kilogramo         (COP/kg)
 *   - Volatilidad:          decimal anualizado        (0.35 = 35 %)
 *   - Tasas:                decimal anual             (0.0425 = 4,25 %)
 */

export type TipoContratoVenta = "precio_fijo_usd" | "por_fijar_ny" | "sin_contrato";

/** Lote de cacao físico sobre el que se evalúa la cobertura. */
export interface Lote {
  toneladas: number;
  costoCopKg: number;
  /** Días calendario desde hoy hasta el embarque. */
  diasAEmbarque: number;
  /** Base esperada frente al futuro NY. Positivo = prima. */
  diferencialUsdTm: number;
  tipoContrato: TipoContratoVenta;
  /** Solo si el contrato es a precio fijo en USD. */
  precioVentaUsdTm?: number | null;
}

/** Fotografía del mercado usada para el cálculo. */
export interface Mercado {
  /** Futuro CC de referencia, USD/TM. */
  futuroUsdTm: number;
  /** TRM vigente, COP/USD. */
  trm: number;
  /** Volatilidad histórica anualizada del futuro CC. */
  volAnualizada: number;
  /** Volatilidad histórica anualizada de la TRM. */
  volTrmAnualizada: number;
  /** Fecha de los datos, ISO (solo informativa). */
  fechaDatos: string;
}

/** Supuestos de cálculo configurables por usuario. */
export interface Supuestos {
  /** Margen inicial exigido por contrato CC, USD. */
  margenInicialUsd: number;
  /** Margen de mantenimiento por contrato CC, USD. */
  margenMantenimientoUsd: number;
  /** Comisión de ida y vuelta por contrato, USD. */
  comisionUsdContrato: number;
  /** Tasa libre de riesgo anual, para descontar primas (Black-76). */
  tasaLibreRiesgo: number;
  diasHabilesAnio: number;
  /** Nivel de confianza del VaR (0.95 = 95 %). */
  nivelConfianzaVar: number;
  trayectoriasMc: number;
  /** Correlación entre el retorno del futuro y el de la TRM. */
  correlacionPrecioTrm: number;
  /** Semilla del generador pseudoaleatorio: hace reproducible el Monte Carlo. */
  semillaMc: number;
}

export const SUPUESTOS_POR_DEFECTO: Supuestos = {
  margenInicialUsd: 8000,
  margenMantenimientoUsd: 7200,
  comisionUsdContrato: 15,
  tasaLibreRiesgo: 0.0425,
  diasHabilesAnio: 252,
  nivelConfianzaVar: 0.95,
  trayectoriasMc: 10000,
  correlacionPrecioTrm: 0,
  semillaMc: 20260911,
};

/**
 * Un estado del mundo en la fecha de embarque.
 *
 * El futuro, la TRM y la base se mueven de forma independiente: ese es
 * justamente el punto del riesgo de base, que la cobertura con futuros
 * no elimina.
 */
export interface Escenario {
  /** Precio del futuro CC en el embarque, USD/TM. */
  futuroUsdTm: number;
  /** TRM en el embarque, COP/USD. */
  trm: number;
  /** Base en el embarque, USD/TM. */
  diferencialUsdTm: number;
  /** Etiqueta legible, p. ej. "futuro -20 % · TRM 0 % · base +100". */
  etiqueta: string;
  /** Desviaciones relativas/absolutas que originaron el escenario. */
  ejes: { precio: number; trm: number; base: number };
}

export type TipoEstrategia =
  | "sin_cobertura"
  | "futuros"
  | "put_protector"
  | "collar"
  | "escalonada";

/** Definición de una estrategia a evaluar. */
export interface Estrategia {
  id: string;
  tipo: TipoEstrategia;
  nombre: string;
  descripcion: string;
  /** Fracción del inventario cubierta (0 a 1). */
  ratioCobertura: number;
  /** Contratos CC vendidos / cubiertos (entero, con signo positivo). */
  contratos: number;
  /** Toneladas cubiertas por los contratos. */
  toneladasCubiertas: number;
  /** Toneladas sin cubrir (positivo) o cubiertas de más (negativo). */
  toneladasResiduales: number;
  /** Strike del put comprado, USD/TM. */
  strikePut?: number;
  /** Strike del call vendido, USD/TM. */
  strikeCall?: number;
  /** Prima neta desembolsada por TM cubierta (positiva = costo). */
  primaNetaUsdTm?: number;
  /** Número de tramos en la fijación escalonada. */
  tramos?: number;
  /** Costo cierto y anticipado de montar la estrategia, en USD. */
  costoInicialUsd: number;
}

/** Descomposición del resultado de una estrategia en un escenario. */
export interface ResultadoEscenario {
  escenario: Escenario;
  /** Precio efectivo de venta del físico, USD/TM. */
  precioFisicoUsdTm: number;
  /** Ingreso por la venta del físico, USD. */
  ingresoFisicoUsd: number;
  /** Resultado de la cobertura (futuros y/o opciones), USD. */
  resultadoCoberturaUsd: number;
  /** Comisiones y primas, USD (siempre ≤ 0). */
  costosCoberturaUsd: number;
  /** Ingreso total en USD antes de convertir. */
  ingresoNetoUsd: number;
  /** Ingreso total convertido a COP a la TRM del escenario. */
  ingresoNetoCop: number;
  /** Costo de adquisición del lote, COP (no depende del escenario). */
  costoAdquisicionCop: number;
  /** Utilidad final, COP. */
  utilidadCop: number;
  /** Utilidad por tonelada, COP/TM. */
  utilidadCopTm: number;
}

/** Resumen comparable de una estrategia sobre toda la matriz. */
export interface ResumenEstrategia {
  estrategia: Estrategia;
  resultados: ResultadoEscenario[];
  peorCaso: ResultadoEscenario;
  mejorCaso: ResultadoEscenario;
  casoBase: ResultadoEscenario;
  /** Media simple de la utilidad sobre la matriz (no es una esperanza). */
  utilidadPromedioCop: number;
  /** Amplitud entre mejor y peor caso: la medida de incertidumbre. */
  rangoUtilidadCop: number;
}
