/**
 * Construcción del resumen cuantitativo que se le entrega al modelo.
 *
 * No se le manda el resultado completo del análisis: son 63 escenarios por
 * cada una de las nueve estrategias más los histogramas, y la mayor parte
 * no aporta nada a una narrativa. Se envía un extracto compacto con
 * exactamente las cifras que el informe puede citar.
 *
 * Eso no es solo ahorro de tokens: cuanto más acotado el material, menos
 * superficie tiene el modelo para equivocarse, y más estricta puede ser
 * la verificación posterior de que no inventó ninguna cifra.
 */

import { CC_TONELADAS_POR_CONTRATO } from "@/lib/engine/constantes";
import type { EvaluacionEstrategia, Recomendacion } from "@/lib/engine/index";
import { operacionDe } from "@/lib/engine/estrategias";
import { precioVentaPactadoUsdTm } from "@/lib/engine/fx";
import type { Lote, Mercado, Supuestos, TipoOperacion } from "@/lib/engine/tipos";

export interface EstrategiaResumida {
  id: string;
  nombre: string;
  contratos: number;
  costoInicialUsd: number;
  utilidadCasoBaseCop: number;
  utilidadPeorCasoCop: number;
  utilidadMejorCasoCop: number;
  utilidadPercentil5Cop: number;
  probabilidadPerdidaPorcentaje: number;
  varCop: number;
  margenInicialCop?: number;
  precioDisparadorMargenUsdTm?: number;
  peorLlamadaMargenCop?: number;
}

export interface ResumenCuantitativo {
  /**
   * Qué negocio se está analizando. Es el campo que decide la narrativa
   * entera: con inventario la cobertura se vende y el riesgo es la caída
   * del precio; con una venta cerrada la cobertura se compra y el riesgo
   * es la subida.
   */
  operacion: {
    tipo: TipoOperacion;
    descripcion: string;
    sentidoCobertura: string;
    riesgoQueCubre: string;
  };
  lote: {
    toneladas: number;
    /** Solo con inventario: lo que ya se pagó por el cacao en bodega. */
    costoCopKg?: number;
    costoTotalCop?: number;
    /** Solo con venta cerrada: el precio al que se pactó la entrega. */
    precioVentaPactadoUsdTm?: number;
    /** Presente solo cuando el diferencial se pactó como porcentaje. */
    diferencialPorcentaje?: number;
    diferencialConcepto?: string;
    diasAEmbarque: number;
    fechaEmbarque: string;
    diferencialUsdTm?: number;
    tipoContrato: string;
  };
  mercado: {
    futuroUsdTm: number;
    trm: number;
    volatilidadCacaoPorcentaje: number;
    volatilidadTrmPorcentaje: number;
    fechaDatos: string;
    fuente: string;
    simbolo: string;
    barrasHistoricas: number;
  };
  /** Con inventario, el precio de venta esperado; con venta cerrada, el costo esperado de abastecerse. */
  precioFisicoEsperadoUsdTm: number;
  /** Etiqueta legible de la cifra anterior, para que el informe no la confunda. */
  precioFisicoEsperadoConcepto: string;
  /** El límite: precio mínimo de venta con inventario, precio máximo de compra con venta cerrada. */
  puntoEquilibrioUsdTm: number;
  puntoEquilibrioConcepto: string;
  exposicionNominalUsd: number;
  exposicionNominalCop: number;
  dimensionamiento: {
    contratosExactos: number;
    contratosSubcobertura: number;
    contratosSobrecobertura: number;
    toneladasResidualesSubcobertura: number;
    toneladasResidualesSobrecobertura: number;
  };
  estrategias: EstrategiaResumida[];
  recomendacion: { id: string; nombre: string; criterio: string };
  supuestos: {
    nivelConfianzaVarPorcentaje: number;
    /**
     * Percentil de la cola adversa que reporta el análisis (5 para un
     * nivel de confianza del 95 %). Va explícito porque el informe lo
     * cita —«el peor 5 %»— y toda cifra citable debe estar aquí para
     * que la verificación posterior pueda rastrearla.
     */
    percentilAdverso: number;
    trayectoriasMonteCarlo: number;
    margenInicialUsdPorContrato: number;
    margenMantenimientoUsdPorContrato: number;
    comisionUsdPorContrato: number;
    tasaLibreRiesgoPorcentaje: number;
    /**
     * Tamaño del riesgo de base simulado, como porcentaje del futuro. Es
     * la parte que la cobertura con futuros NO elimina, y el informe
     * debería poder nombrarla.
     */
    riesgoBasePorcentajeDelFuturo: number;
  };
  constantes: {
    toneladasPorContratoCC: number;
    escenariosEvaluados: number;
  };
  advertencias: string[];
}

/** Redondea a `decimales` para que la cifra citada sea la que se verifica. */
function r(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

export interface EntradaResumen {
  lote: Lote;
  fechaEmbarque: string;
  mercado: Mercado;
  supuestos: Supuestos;
  evaluaciones: EvaluacionEstrategia[];
  recomendacion: Recomendacion;
  precioEquilibrioUsdTm: number;
  dimensionamiento: {
    contratosExactos: number;
    subcobertura: { contratos: number; toneladasResiduales: number };
    sobrecobertura: { contratos: number; toneladasResiduales: number };
  };
  procedencia: { fuente: string; simbolo: string; barras: number };
  advertencias: string[];
}

/** Extrae el resumen cuantitativo a partir de un análisis ya calculado. */
export function construirResumen(entrada: EntradaResumen): ResumenCuantitativo {
  const { lote, mercado, supuestos, evaluaciones, recomendacion } = entrada;

  const operacion = operacionDe(lote);
  const esInventario = operacion === "inventario_sin_vender";

  // Con inventario el precio que flota es el de venta; con una venta ya
  // cerrada lo que flota es lo que costará comprar el físico. Son cifras
  // distintas y el informe no puede intercambiarlas.
  const precioFisico = esInventario
    ? lote.tipoContrato === "precio_fijo_usd" && lote.precioVentaUsdTm != null
      ? lote.precioVentaUsdTm
      : mercado.futuroUsdTm + lote.diferencialUsdTm
    : mercado.futuroUsdTm + lote.diferencialUsdTm;

  const exposicionUsd = lote.toneladas * precioFisico;

  return {
    operacion: {
      tipo: operacion,
      descripcion: esInventario
        ? "Tiene cacao en bodega sin vender."
        : "Ya cerró la venta a un precio en firme y todavía debe comprar el cacao para entregarlo.",
      sentidoCobertura: esInventario
        ? "cobertura corta: se VENDEN futuros"
        : "cobertura larga: se COMPRAN futuros",
      riesgoQueCubre: esInventario
        ? "que el precio del cacao BAJE antes de vender"
        : "que el precio del cacao SUBA antes de comprar",
    },
    lote: {
      toneladas: r(lote.toneladas, 3),
      ...(esInventario
        ? {
            costoCopKg: r(lote.costoCopKg),
            costoTotalCop: r(lote.toneladas * lote.costoCopKg * 1000, 0),
          }
        : { precioVentaPactadoUsdTm: r(precioVentaPactadoUsdTm(lote)) }),
      diasAEmbarque: lote.diasAEmbarque,
      fechaEmbarque: entrada.fechaEmbarque,
      ...(lote.diferencialPorcentual != null
        ? {
            diferencialPorcentaje: r(lote.diferencialPorcentual * 100, 2),
            diferencialConcepto:
              "el diferencial se pactó como porcentaje del cierre de Nueva York, no como una cantidad fija: el precio del físico se mueve solo (100 + ese porcentaje) % de lo que se mueve la bolsa, y por eso la cobertura cubre menos toneladas de las que tiene el lote",
          }
        : { diferencialUsdTm: r(lote.diferencialUsdTm) }),
      tipoContrato: lote.tipoContrato,
    },
    mercado: {
      futuroUsdTm: r(mercado.futuroUsdTm),
      trm: r(mercado.trm),
      volatilidadCacaoPorcentaje: r(mercado.volAnualizada * 100, 1),
      volatilidadTrmPorcentaje: r(mercado.volTrmAnualizada * 100, 1),
      fechaDatos: mercado.fechaDatos,
      fuente: entrada.procedencia.fuente,
      simbolo: entrada.procedencia.simbolo,
      barrasHistoricas: entrada.procedencia.barras,
    },
    precioFisicoEsperadoUsdTm: r(precioFisico),
    precioFisicoEsperadoConcepto: esInventario
      ? "precio de venta esperado del cacao"
      : "costo esperado de comprar el cacao (bolsa más diferencial que se le paga al productor)",
    puntoEquilibrioUsdTm: r(entrada.precioEquilibrioUsdTm),
    puntoEquilibrioConcepto: esInventario
      ? "precio mínimo de venta que cubre el costo ya pagado por el cacao"
      : "precio máximo de compra que cabe dentro del ingreso ya pactado",
    exposicionNominalUsd: r(exposicionUsd, 0),
    exposicionNominalCop: r(exposicionUsd * mercado.trm, 0),
    dimensionamiento: {
      contratosExactos: r(entrada.dimensionamiento.contratosExactos),
      contratosSubcobertura: entrada.dimensionamiento.subcobertura.contratos,
      contratosSobrecobertura: entrada.dimensionamiento.sobrecobertura.contratos,
      toneladasResidualesSubcobertura: r(
        entrada.dimensionamiento.subcobertura.toneladasResiduales,
      ),
      toneladasResidualesSobrecobertura: r(
        entrada.dimensionamiento.sobrecobertura.toneladasResiduales,
      ),
    },
    estrategias: evaluaciones.map((e) => {
      const { estrategia, peorCaso, mejorCaso, casoBase } = e.resumen;
      return {
        id: estrategia.id,
        nombre: estrategia.nombre,
        contratos: estrategia.contratos,
        costoInicialUsd: r(estrategia.costoInicialUsd, 0),
        utilidadCasoBaseCop: r(casoBase.utilidadCop, 0),
        utilidadPeorCasoCop: r(peorCaso.utilidadCop, 0),
        utilidadMejorCasoCop: r(mejorCaso.utilidadCop, 0),
        utilidadPercentil5Cop: r(e.monteCarlo.percentiles.p5, 0),
        probabilidadPerdidaPorcentaje: r(e.monteCarlo.probabilidadPerdida * 100, 1),
        varCop: r(e.var.varCop, 0),
        ...(e.margen
          ? {
              margenInicialCop: r(e.margen.margenInicialTotalCop, 0),
              precioDisparadorMargenUsdTm: r(e.margen.precioDisparadorUsdTm),
              peorLlamadaMargenCop: r(e.margen.peorLlamada?.montoCop ?? 0, 0),
            }
          : {}),
      };
    }),
    recomendacion: {
      id: recomendacion.idEstrategia,
      nombre: recomendacion.nombre,
      criterio: recomendacion.criterio,
    },
    supuestos: {
      nivelConfianzaVarPorcentaje: r(supuestos.nivelConfianzaVar * 100, 1),
      percentilAdverso: r((1 - supuestos.nivelConfianzaVar) * 100, 1),
      trayectoriasMonteCarlo: supuestos.trayectoriasMc,
      margenInicialUsdPorContrato: r(supuestos.margenInicialUsd, 0),
      margenMantenimientoUsdPorContrato: r(supuestos.margenMantenimientoUsd, 0),
      comisionUsdPorContrato: r(supuestos.comisionUsdContrato),
      tasaLibreRiesgoPorcentaje: r(supuestos.tasaLibreRiesgo * 100, 2),
      riesgoBasePorcentajeDelFuturo: r((supuestos.desviacionBaseFraccion ?? 0) * 100, 2),
    },
    constantes: {
      toneladasPorContratoCC: CC_TONELADAS_POR_CONTRATO,
      escenariosEvaluados: evaluaciones[0]?.resumen.resultados.length ?? 0,
    },
    advertencias: entrada.advertencias,
  };
}
