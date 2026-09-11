/**
 * Dimensionamiento de la cobertura en contratos CC.
 *
 * Un contrato cubre exactamente 10 TM y no es divisible, así que casi
 * nunca calza con el inventario real. Ese descalce obligatorio es la
 * primera decisión del exportador: quedarse corto de cobertura y
 * conservar exposición al precio, o pasarse y quedar neto vendido sobre
 * toneladas que no tiene.
 */

import { CC_TONELADAS_POR_CONTRATO } from "./constantes";
import type { SentidoCobertura } from "./tipos";

/** Toneladas con dos decimales y coma decimal, como se escribe en Colombia. */
function tm(valor: number): string {
  return valor.toLocaleString("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface AlternativaCobertura {
  /** Contratos CC a vender (cobertura corta) o a comprar (larga). */
  contratos: number;
  /** Toneladas efectivamente cubiertas (contratos × 10). */
  toneladasCubiertas: number;
  /**
   * Toneladas descubiertas (positivo) o cubiertas de más (negativo).
   * Negativo significa posición neta vendida: especulación, no cobertura.
   */
  toneladasResiduales: number;
  /** Cobertura efectiva sobre el objetivo (1 = exacta). */
  ratioEfectivo: number;
  tipo: "subcobertura" | "sobrecobertura" | "exacta";
  /** Explicación de la exposición que queda viva. */
  exposicionResidual: string;
}

export interface DimensionamientoCobertura {
  toneladas: number;
  ratioObjetivo: number;
  toneladasObjetivo: number;
  /** Contratos exactos que haría falta: casi siempre fraccionario. */
  contratosExactos: number;
  subcobertura: AlternativaCobertura;
  sobrecobertura: AlternativaCobertura;
  /** La alternativa cuyo residual es menor en valor absoluto. */
  recomendada: AlternativaCobertura;
}

function construirAlternativa(
  contratos: number,
  toneladasObjetivo: number,
  sentido: SentidoCobertura,
): AlternativaCobertura {
  const toneladasCubiertas = contratos * CC_TONELADAS_POR_CONTRATO;
  const toneladasResiduales = toneladasObjetivo - toneladasCubiertas;

  const tipo =
    toneladasResiduales > 1e-9
      ? "subcobertura"
      : toneladasResiduales < -1e-9
        ? "sobrecobertura"
        : "exacta";

  // El descalce duele en direcciones opuestas según el sentido: quien
  // cubre inventario teme la baja y quien cubre una compra pendiente teme
  // la subida. Decirlo al revés es peor que no decirlo.
  const corta = sentido === "corta";
  const exposicionResidual =
    tipo === "subcobertura"
      ? `${tm(toneladasResiduales)} TM quedan expuestas a la ${corta ? "baja" : "subida"} del precio.`
      : tipo === "sobrecobertura"
        ? corta
          ? `${tm(Math.abs(toneladasResiduales))} TM vendidas sin físico detrás: posición neta corta, expuesta a la subida del precio.`
          : `${tm(Math.abs(toneladasResiduales))} TM compradas sin venta detrás: posición neta larga, expuesta a la baja del precio.`
        : "Sin exposición residual: la cobertura calza exactamente con el objetivo.";

  return {
    contratos,
    toneladasCubiertas,
    toneladasResiduales,
    ratioEfectivo: toneladasObjetivo > 0 ? toneladasCubiertas / toneladasObjetivo : 0,
    tipo,
    exposicionResidual,
  };
}

/**
 * Calcula las dos alternativas de dimensionamiento para un inventario y
 * un ratio de cobertura objetivo.
 *
 * @param toneladas    Toneladas a cubrir: el inventario físico en una
 *                     cobertura corta, lo que falta por comprar en una larga.
 * @param ratioObjetivo Fracción a cubrir (0 a 1). 1 = cobertura total.
 * @param sentido      Solo cambia cómo se describe el residual; el
 *                     redondeo es idéntico en ambos sentidos.
 */
export function dimensionarCobertura(
  toneladas: number,
  ratioObjetivo = 1,
  sentido: SentidoCobertura = "corta",
): DimensionamientoCobertura {
  if (toneladas <= 0) {
    throw new Error("Las toneladas deben ser mayores que cero.");
  }
  if (ratioObjetivo < 0 || ratioObjetivo > 1) {
    throw new Error("El ratio de cobertura debe estar entre 0 y 1.");
  }

  const toneladasObjetivo = toneladas * ratioObjetivo;
  const contratosExactos = toneladasObjetivo / CC_TONELADAS_POR_CONTRATO;

  const sub = construirAlternativa(Math.floor(contratosExactos), toneladasObjetivo, sentido);
  const sobre = construirAlternativa(Math.ceil(contratosExactos), toneladasObjetivo, sentido);

  // Con residuales empatados en magnitud se prefiere la subcobertura:
  // quedarse corto de cobertura es menos grave que abrir una posición
  // especulativa sobre toneladas que no existen.
  const recomendada =
    Math.abs(sub.toneladasResiduales) <= Math.abs(sobre.toneladasResiduales)
      ? sub
      : sobre;

  return {
    toneladas,
    ratioObjetivo,
    toneladasObjetivo,
    contratosExactos,
    subcobertura: sub,
    sobrecobertura: sobre,
    recomendada,
  };
}

/** Valor nocional de una posición en contratos CC, en USD. */
export function nocionalUsd(contratos: number, precioUsdTm: number): number {
  return contratos * CC_TONELADAS_POR_CONTRATO * precioUsdTm;
}
