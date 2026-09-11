/**
 * Volatilidad histórica a partir de una serie de precios de cierre.
 *
 * Se usa para dimensionar el VaR y para sembrar el Monte Carlo. Si la
 * serie es demasiado corta o degenerada, el llamador debe caer al valor
 * de respaldo de `configuracion.vol_fallback` en vez de operar con un
 * número sin sentido.
 */

import { DIAS_HABILES_ANIO } from "./constantes";
import { desviacionEstandar } from "./numerico";

/** Mínimo de observaciones para que una volatilidad sea defendible. */
export const MINIMO_OBSERVACIONES = 20;

export interface ResultadoVolatilidad {
  /** Volatilidad anualizada en decimal (0.35 = 35 %). */
  anualizada: number;
  /** Desviación estándar de los retornos diarios. */
  diaria: number;
  /** Número de retornos usados (n-1 respecto a los precios). */
  observaciones: number;
  /** true si se usó el valor de respaldo por serie insuficiente. */
  usoRespaldo: boolean;
}

/** Retornos logarítmicos de una serie de cierres, en orden cronológico. */
export function retornosLogaritmicos(cierres: readonly number[]): number[] {
  const retornos: number[] = [];
  for (let i = 1; i < cierres.length; i++) {
    const anterior = cierres[i - 1];
    const actual = cierres[i];
    // Un cierre no positivo es un dato corrupto, no un precio: se omite.
    if (anterior > 0 && actual > 0) {
      retornos.push(Math.log(actual / anterior));
    }
  }
  return retornos;
}

/**
 * Volatilidad histórica anualizada.
 *
 * @param cierres        Serie de cierres en orden cronológico ascendente.
 * @param volRespaldo    Valor a devolver si la serie no alcanza el mínimo.
 * @param diasHabilesAnio Base de anualización (252 por defecto).
 */
export function volatilidadHistorica(
  cierres: readonly number[],
  volRespaldo = 0.35,
  diasHabilesAnio = DIAS_HABILES_ANIO,
): ResultadoVolatilidad {
  const retornos = retornosLogaritmicos(cierres);

  if (retornos.length < MINIMO_OBSERVACIONES) {
    return {
      anualizada: volRespaldo,
      diaria: volRespaldo / Math.sqrt(diasHabilesAnio),
      observaciones: retornos.length,
      usoRespaldo: true,
    };
  }

  const diaria = desviacionEstandar(retornos);

  // Una serie constante da desviación cero: matemáticamente válido,
  // pero inservible para valorar opciones o simular trayectorias.
  if (!Number.isFinite(diaria) || diaria <= 0) {
    return {
      anualizada: volRespaldo,
      diaria: volRespaldo / Math.sqrt(diasHabilesAnio),
      observaciones: retornos.length,
      usoRespaldo: true,
    };
  }

  return {
    anualizada: diaria * Math.sqrt(diasHabilesAnio),
    diaria,
    observaciones: retornos.length,
    usoRespaldo: false,
  };
}

/**
 * Escala una volatilidad anualizada a un horizonte en años.
 * Regla de la raíz del tiempo: σ_T = σ_anual × √T.
 */
export function volatilidadHorizonte(volAnualizada: number, anios: number): number {
  if (anios < 0) throw new Error("El horizonte no puede ser negativo.");
  return volAnualizada * Math.sqrt(anios);
}

/** Días calendario → años, base 365. */
export function diasAAnios(dias: number): number {
  return dias / 365;
}
