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
import type { Lote, Mercado, Supuestos } from "@/lib/engine/tipos";

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
  lote: {
    toneladas: number;
    costoCopKg: number;
    costoTotalCop: number;
    diasAEmbarque: number;
    fechaEmbarque: string;
    diferencialUsdTm: number;
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
  precioVentaEsperadoUsdTm: number;
  puntoEquilibrioUsdTm: number;
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

  const precioVenta =
    lote.tipoContrato === "precio_fijo_usd" && lote.precioVentaUsdTm != null
      ? lote.precioVentaUsdTm
      : mercado.futuroUsdTm + lote.diferencialUsdTm;

  const exposicionUsd = lote.toneladas * precioVenta;

  return {
    lote: {
      toneladas: r(lote.toneladas, 3),
      costoCopKg: r(lote.costoCopKg),
      costoTotalCop: r(lote.toneladas * lote.costoCopKg * 1000, 0),
      diasAEmbarque: lote.diasAEmbarque,
      fechaEmbarque: entrada.fechaEmbarque,
      diferencialUsdTm: r(lote.diferencialUsdTm),
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
    precioVentaEsperadoUsdTm: r(precioVenta),
    puntoEquilibrioUsdTm: r(entrada.precioEquilibrioUsdTm),
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
    },
    constantes: {
      toneladasPorContratoCC: CC_TONELADAS_POR_CONTRATO,
      escenariosEvaluados: evaluaciones[0]?.resumen.resultados.length ?? 0,
    },
    advertencias: entrada.advertencias,
  };
}
