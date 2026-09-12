/**
 * Punto de entrada del motor de cálculo de CacaoHedge.
 *
 * `analizarCobertura` recibe el lote, la fotografía del mercado y los
 * supuestos del usuario, y devuelve el objeto completo que se guarda en
 * `analisis.resultados` y que después alimenta la UI y el informe
 * narrativo.
 *
 * El motor es puro: no lee de la red, no consulta el reloj del sistema y
 * no usa aleatoriedad sin semilla. Guardar sus entradas basta para
 * reproducir bit a bit el mismo análisis meses después.
 */

import { construirEstrategias, operacionDe, resumirEstrategia } from "./estrategias";
import { construirMatrizEscenarios } from "./escenarios";
import { dimensionarCobertura, type DimensionamientoCobertura } from "./contratos";
import {
  diferencialEnEscenarioUsdTm,
  esDiferencialPorcentual,
  precioEquilibrioUsdTm,
  precioMaximoCompraUsdTm,
  toneladasExpuestasAlPrecio,
} from "./fx";
import {
  analizarMargen,
  calcularExposicion,
  varParametrico,
  type AnalisisMargen,
  type Exposicion,
  type ResultadoVar,
} from "./riesgo";
import {
  opcionesDesdeSupuestos,
  simularMonteCarlo,
  type DistribucionMonteCarlo,
} from "./montecarlo";
import { diasAAnios } from "./volatilidad";
import {
  SUPUESTOS_POR_DEFECTO,
  type Lote,
  type Mercado,
  type ResumenEstrategia,
  sentidoDe,
  type Supuestos,
  type TipoOperacion,
} from "./tipos";

export interface EvaluacionEstrategia {
  resumen: ResumenEstrategia;
  exposicion: Exposicion;
  var: ResultadoVar;
  /** null cuando la estrategia no usa futuros vendidos. */
  margen: AnalisisMargen | null;
  monteCarlo: DistribucionMonteCarlo;
}

export interface Recomendacion {
  /** Identificador de la estrategia mejor posicionada. */
  idEstrategia: string;
  nombre: string;
  criterio: string;
  justificacion: string;
  /** Cuánto cuesta esa protección en utilidad media, COP. */
  costoEnUtilidadMediaCop: number;
}

export interface ResultadoAnalisis {
  lote: Lote;
  mercado: Mercado;
  supuestos: Supuestos;
  /** Situación del negocio que se analizó. */
  operacion: TipoOperacion;
  /** Horizonte hasta el embarque, en años. */
  aniosHorizonte: number;
  /**
   * Precio límite en USD/TM más allá del cual el negocio deja de ganar.
   *
   * Con inventario es el precio mínimo de VENTA que cubre el costo ya
   * pagado; con una venta cerrada, el precio máximo de COMPRA que cabe
   * dentro del ingreso pactado. En los dos casos es la frontera.
   */
  precioEquilibrioUsdTm: number;
  dimensionamiento: DimensionamientoCobertura;
  evaluaciones: EvaluacionEstrategia[];
  recomendacion: Recomendacion;
  /** Riesgos estructurales detectados en las entradas. */
  advertencias: string[];
}

/**
 * Revisa la coherencia económica de las entradas.
 *
 * Estas advertencias no bloquean el cálculo: señalan situaciones en las
 * que el número, aun siendo correcto, se puede leer mal.
 */
export function detectarAdvertencias(lote: Lote, mercado: Mercado): string[] {
  const advertencias: string[] = [];
  const esInventario = operacionDe(lote) === "inventario_sin_vender";

  if (esInventario && lote.tipoContrato === "precio_fijo_usd") {
    advertencias.push(
      "El contrato ya tiene precio fijo en USD: el riesgo de precio del cacao está cerrado. Vender futuros sobre este lote no sería cobertura sino una posición especulativa. El riesgo que queda vivo es el cambiario.",
    );
  }

  if (!esInventario) {
    advertencias.push(
      "La cobertura se cierra cuando compre el físico. Dejar los futuros abiertos después de abastecerse deja de ser cobertura y pasa a ser una posición especulativa.",
    );
  }

  if (lote.diasAEmbarque <= 0) {
    advertencias.push(
      "El embarque es hoy o ya pasó: sin horizonte, las opciones no tienen valor temporal y el VaR es cero. Verifique la fecha.",
    );
  }

  if (lote.diasAEmbarque > 365) {
    advertencias.push(
      "El horizonte supera un año. La liquidez de los futuros CC se concentra en los vencimientos cercanos, así que una cobertura tan larga puede ser cara de montar y de rolar.",
    );
  }

  if (esInventario) {
    const precioEquilibrio = precioEquilibrioUsdTm(lote.costoCopKg, mercado.trm);
    const precioVenta =
      lote.tipoContrato === "precio_fijo_usd" && lote.precioVentaUsdTm != null
        ? lote.precioVentaUsdTm
        : mercado.futuroUsdTm + diferencialEnEscenarioUsdTm(lote, mercado.futuroUsdTm);

    if (precioVenta <= precioEquilibrio) {
      advertencias.push(
        `El precio de venta estimado (${precioVenta.toFixed(0)} USD/TM) no cubre el costo de adquisición (${precioEquilibrio.toFixed(0)} USD/TM a la TRM vigente). Ninguna cobertura convierte en rentable un lote comprado por encima del mercado: solo fija la pérdida.`,
      );
    }
  } else if (lote.precioVentaUsdTm != null) {
    const maximo = precioMaximoCompraUsdTm(lote.precioVentaUsdTm, lote);
    if (mercado.futuroUsdTm >= maximo) {
      advertencias.push(
        `El futuro ya está en ${mercado.futuroUsdTm.toFixed(0)} USD/TM y su margen se agota a partir de ${maximo.toFixed(0)}. La venta se cerró por debajo de lo que hoy cuesta abastecerla: cubrirse fija esa pérdida, no la evita.`,
      );
    }
  }

  if (!esDiferencialPorcentual(lote) && Math.abs(lote.diferencialUsdTm) > 1500) {
    advertencias.push(
      "El diferencial declarado es inusualmente grande. Verifique que esté expresado en USD por tonelada métrica y no por quintal o por libra.",
    );
  }

  return advertencias;
}

/** Formatea un monto en COP a millones, sin precisión falsa. */
function formatearMillones(cop: number): string {
  return `${(cop / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} millones de COP`;
}

/**
 * Error estándar de la diferencia de medias entre dos estrategias.
 *
 * Ambas se simulan con las mismas trayectorias (números aleatorios
 * comunes), así que la comparación es pareada y la cota es conservadora.
 */
function errorEstandarMedia(a: EvaluacionEstrategia, b: EvaluacionEstrategia): number {
  const n = Math.min(a.monteCarlo.trayectorias, b.monteCarlo.trayectorias);
  const desviacion = Math.max(a.monteCarlo.desviacionCop, b.monteCarlo.desviacionCop);
  return desviacion / Math.sqrt(n);
}

/**
 * Elige la estrategia recomendada por el peor 5 % de los resultados.
 *
 * El criterio es deliberado: un exportador con inventario financiado no
 * se juega la empresa por la utilidad promedio, sino por lo que pasa en
 * el mal escenario. Se maximiza el percentil 5 de la utilidad simulada y
 * se explicita cuánta utilidad media cuesta esa tranquilidad.
 */
export function recomendar(evaluaciones: readonly EvaluacionEstrategia[]): Recomendacion {
  if (evaluaciones.length === 0) {
    throw new Error("No hay estrategias que comparar.");
  }

  const mejor = evaluaciones.reduce((a, b) =>
    b.monteCarlo.percentiles.p5 > a.monteCarlo.percentiles.p5 ? b : a,
  );

  const sinCobertura =
    evaluaciones.find((e) => e.resumen.estrategia.tipo === "sin_cobertura") ?? mejor;

  const mejoraP5 =
    mejor.monteCarlo.percentiles.p5 - sinCobertura.monteCarlo.percentiles.p5;
  const costoMedia = sinCobertura.monteCarlo.mediaCop - mejor.monteCarlo.mediaCop;

  // Una simulación tiene error de muestreo: por debajo de ese umbral la
  // diferencia entre dos estrategias es ruido, no un efecto económico, y
  // reportarla con precisión de pesos sería inventar señal.
  const umbralRuido = errorEstandarMedia(sinCobertura, mejor);
  const diferenciaMediaSignificativa = Math.abs(costoMedia) > 2 * umbralRuido;

  const fraseMedia = diferenciaMediaSignificativa
    ? `a cambio de ${formatearMillones(Math.abs(costoMedia))} ${costoMedia >= 0 ? "menos" : "más"} de utilidad media`
    : "sin sacrificar utilidad media de forma apreciable";

  const justificacion =
    mejor.resumen.estrategia.tipo === "sin_cobertura"
      ? "Ninguna de las coberturas evaluadas mejora el peor 5 % de los resultados frente a no hacer nada. Con los supuestos actuales, el costo de cubrirse pesa más que la protección que aporta."
      : `Mejora el percentil 5 de la utilidad en ${formatearMillones(mejoraP5)} frente a no cubrirse, ${fraseMedia}. Reduce la probabilidad de pérdida del ${(sinCobertura.monteCarlo.probabilidadPerdida * 100).toFixed(1)} % al ${(mejor.monteCarlo.probabilidadPerdida * 100).toFixed(1)} %.`;

  return {
    idEstrategia: mejor.resumen.estrategia.id,
    nombre: mejor.resumen.estrategia.nombre,
    criterio: "Mayor utilidad en el percentil 5 de la simulación Monte Carlo",
    justificacion,
    costoEnUtilidadMediaCop: costoMedia,
  };
}

/** Ejecuta el análisis completo de cobertura para un lote. */
export function analizarCobertura(
  lote: Lote,
  mercado: Mercado,
  supuestosParciales: Partial<Supuestos> = {},
): ResultadoAnalisis {
  const supuestos: Supuestos = { ...SUPUESTOS_POR_DEFECTO, ...supuestosParciales };

  const escenarios = construirMatrizEscenarios(mercado, (futuro) =>
    diferencialEnEscenarioUsdTm(lote, futuro),
  );
  const estrategias = construirEstrategias(lote, mercado, supuestos);
  const opcionesMc = opcionesDesdeSupuestos(supuestos);

  const evaluaciones: EvaluacionEstrategia[] = estrategias.map((estrategia) => {
    const exposicion = calcularExposicion(estrategia, lote, mercado, supuestos);
    return {
      resumen: resumirEstrategia(estrategia, lote, mercado, escenarios, supuestos),
      exposicion,
      var: varParametrico(exposicion, mercado, supuestos, lote.diasAEmbarque),
      margen: analizarMargen(estrategia, mercado, supuestos, escenarios),
      monteCarlo: simularMonteCarlo(estrategia, lote, mercado, supuestos, opcionesMc),
    };
  });

  return {
    lote,
    mercado,
    supuestos,
    operacion: operacionDe(lote),
    aniosHorizonte: diasAAnios(lote.diasAEmbarque),
    precioEquilibrioUsdTm:
      operacionDe(lote) === "inventario_sin_vender"
        ? precioEquilibrioUsdTm(lote.costoCopKg, mercado.trm)
        : precioMaximoCompraUsdTm(lote.precioVentaUsdTm ?? 0, lote),
    dimensionamiento: dimensionarCobertura(
      toneladasExpuestasAlPrecio(lote),
      1,
      sentidoDe(operacionDe(lote)),
    ),
    evaluaciones,
    recomendacion: recomendar(evaluaciones),
    advertencias: detectarAdvertencias(lote, mercado),
  };
}

// Reexportación de la superficie pública del motor.
export * from "./constantes";
export * from "./contratos";
export * from "./escenarios";
export * from "./estrategias";
export * from "./fx";
export * from "./montecarlo";
export * from "./numerico";
export * from "./opciones";
export * from "./riesgo";
export * from "./tipos";
export * from "./volatilidad";
