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

/**
 * Las dos situaciones del negocio, con riesgos opuestos.
 *
 * - `inventario_sin_vender`: el cacao está en bodega y falta venderlo. El
 *   costo de adquisición ya está hundido y conocido; el ingreso flota con
 *   el precio. El riesgo es que BAJE, y se cubre VENDIENDO futuros.
 *
 * - `venta_sin_comprar`: la venta está cerrada y falta comprar el físico.
 *   El ingreso ya está pactado; el costo flota con el precio. El riesgo es
 *   que SUBA, y se cubre COMPRANDO futuros.
 *
 * No es una variante del mismo cálculo: invierte el signo de la cobertura,
 * cambia el instrumento de protección (call en vez de put), voltea cuál es
 * el escenario adverso y cambia el sentido de las llamadas de margen.
 */
export type TipoOperacion = "inventario_sin_vender" | "venta_sin_comprar";

/** Sentido de la posición en bolsa. Corta vende futuros; larga los compra. */
export type SentidoCobertura = "corta" | "larga";

/** La cobertura de cada situación va en sentido contrario al riesgo. */
export function sentidoDe(operacion: TipoOperacion): SentidoCobertura {
  return operacion === "inventario_sin_vender" ? "corta" : "larga";
}

/** Lote de cacao sobre el que se evalúa la cobertura. */
export interface Lote {
  /** Situación del negocio. Por defecto, inventario en bodega sin vender. */
  tipoOperacion?: TipoOperacion;
  toneladas: number;
  /**
   * Costo de adquisición ya pagado, COP/kg.
   *
   * Solo aplica a `inventario_sin_vender`: en `venta_sin_comprar` el cacao
   * todavía no se ha comprado y el costo es justamente lo incierto.
   */
  costoCopKg: number;
  /** Días calendario hasta el embarque (o hasta la compra del físico). */
  diasAEmbarque: number;
  /**
   * Base frente al futuro NY, USD/TM. Positivo = prima.
   *
   * En `inventario_sin_vender` es la prima que RECIBE al vender; en
   * `venta_sin_comprar`, la que PAGA al comprarle al productor.
   */
  diferencialUsdTm: number;
  /**
   * Diferencial pactado como fracción del futuro, no como cantidad fija.
   * −0,235 = 23,5 % por debajo de Nueva York.
   *
   * Cuando está presente MANDA sobre `diferencialUsdTm`, que pasa a ser
   * un valor derivado del futuro de cada escenario.
   *
   * La distinción no es cosmética. Con un diferencial fijo el precio del
   * físico se mueve dólar por dólar con la bolsa y hay que cubrir el
   * 100 % de las toneladas. Con uno porcentual el precio se mueve solo
   * (1 + fracción) por cada dólar —quien compra un 23,5 % por debajo solo
   * está expuesto al 76,5 % del movimiento—, y cubrir el 100 % de las
   * toneladas deja una posición especulativa encima de la cobertura.
   */
  diferencialPorcentual?: number | null;
  tipoContrato: TipoContratoVenta;
  /**
   * Precio de venta pactado, USD/TM.
   *
   * Obligatorio en `venta_sin_comprar`: es el ingreso ya cerrado, el dato
   * que hace que la operación tenga sentido.
   */
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
  /**
   * Desviación típica del diferencial al horizonte, como FRACCIÓN del
   * futuro. 0,033 = 3,3 % del precio de Nueva York.
   *
   * Va en fracción y no en USD/TM porque la base escala con el nivel de
   * precios: los mismos 100 USD/TM eran un 1,7 % con el cacao a 6.000 y
   * habrían sido un 0,8 % con el cacao a 12.000.
   *
   * El valor por defecto sale de medir 175 días del precio que publican
   * Nacional de Chocolates y Casa Luker contra el futuro CC: el descuento
   * tiene una desviación de 3,3 puntos porcentuales alrededor de su
   * mediana. El valor anterior —50 USD/TM, un 0,8 %— subestimaba el
   * riesgo de base cuatro veces, y es el único riesgo que la cobertura
   * con futuros no toca.
   *
   * Se usa sin escalar por raíz del tiempo a propósito: el descuento
   * REVIERTE a su media (cruza su mediana 36 veces en 175 días), así que
   * tratarlo como un paseo aleatorio inflaría la dispersión al horizonte.
   * Lo que se usa es su distribución incondicional.
   */
  desviacionBaseFraccion: number;
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
  desviacionBaseFraccion: 0.033,
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
  /** Futuros. El sentido lo fija `Estrategia.sentido`, no el tipo. */
  | "futuros"
  /** Pone piso al precio de venta. Solo tiene sentido con inventario. */
  | "put_protector"
  /** Pone techo al precio de compra. Solo tiene sentido con venta cerrada. */
  | "call_protector"
  /** Compra put y vende call: acota la caída cediendo la subida. */
  | "collar"
  /** Compra call y vende put: acota la subida cediendo la caída. */
  | "collar_inverso"
  | "escalonada";

/** Definición de una estrategia a evaluar. */
export interface Estrategia {
  id: string;
  tipo: TipoEstrategia;
  /**
   * Sentido de la posición en bolsa.
   *
   * Va explícito y no deducido del tipo porque «futuros» y «escalonada»
   * existen en ambos sentidos: es justo el dato que distingue cubrir un
   * inventario de cubrir una compra pendiente.
   */
  sentido: SentidoCobertura;
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
  /** Precio efectivo del físico en el escenario, USD/TM. */
  precioFisicoUsdTm: number;
  /** Ingreso por la venta del físico, USD. */
  ingresoFisicoUsd: number;
  /**
   * Costo de comprar el físico, USD.
   *
   * Cero cuando el cacao ya está en bodega: ese costo ya se pagó y vive en
   * `costoAdquisicionCop`.
   */
  costoFisicoUsd: number;
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
