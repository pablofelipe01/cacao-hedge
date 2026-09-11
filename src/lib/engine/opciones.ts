/**
 * Valoración de opciones sobre futuros: modelo Black-76.
 *
 * Las opciones de cacao de ICE son opciones sobre el futuro CC, no sobre
 * el físico, así que el modelo correcto es Black-76 y no Black-Scholes:
 * el subyacente es un futuro, que bajo la medida neutral al riesgo no
 * tiene deriva (no hay costo de acarreo ni dividendo que modelar).
 *
 * Las primas se expresan en USD/TM, igual que el futuro.
 */

import { CC_TONELADAS_POR_CONTRATO } from "./constantes";
import { densidadNormal, normalAcumulada } from "./numerico";
import type { Supuestos } from "./tipos";

export type TipoOpcion = "put" | "call";

export interface ParametrosOpcion {
  /** Precio del futuro subyacente, USD/TM. */
  futuro: number;
  /** Precio de ejercicio, USD/TM. */
  strike: number;
  /** Tiempo al vencimiento en años. */
  anios: number;
  /** Volatilidad anualizada en decimal. */
  volatilidad: number;
  /** Tasa libre de riesgo anual en decimal. */
  tasa: number;
}

export interface ValoracionOpcion {
  /** Prima por tonelada métrica, USD/TM. */
  primaUsdTm: number;
  /** Prima por contrato (× 10 TM), USD. */
  primaUsdContrato: number;
  /** Sensibilidad al precio del futuro. Negativa para puts. */
  delta: number;
  /** Sensibilidad del delta al precio. */
  gamma: number;
  /** Sensibilidad a la volatilidad, por punto de vol (1.00 = 100 %). */
  vega: number;
}

/**
 * Valor intrínseco al vencimiento, USD/TM. Es el payoff que efectivamente
 * se cobra; la valoración Black-76 solo sirve para estimar la prima que
 * se paga hoy.
 */
export function payoffOpcion(
  tipo: TipoOpcion,
  futuroFinal: number,
  strike: number,
): number {
  return tipo === "put"
    ? Math.max(strike - futuroFinal, 0)
    : Math.max(futuroFinal - strike, 0);
}

/**
 * Prima y griegas bajo Black-76.
 *
 * Con vencimiento o volatilidad nulos el modelo degenera y la prima es
 * el valor intrínseco descontado: se atiende ese caso aparte para no
 * dividir por cero.
 */
export function valorarOpcion(
  tipo: TipoOpcion,
  { futuro, strike, anios, volatilidad, tasa }: ParametrosOpcion,
): ValoracionOpcion {
  if (futuro <= 0 || strike <= 0) {
    throw new Error("El futuro y el strike deben ser mayores que cero.");
  }

  const descuento = Math.exp(-tasa * anios);

  if (anios <= 0 || volatilidad <= 0) {
    const intrinseco = payoffOpcion(tipo, futuro, strike);
    const primaUsdTm = intrinseco * descuento;
    return {
      primaUsdTm,
      primaUsdContrato: primaUsdTm * CC_TONELADAS_POR_CONTRATO,
      delta: intrinseco > 0 ? (tipo === "put" ? -descuento : descuento) : 0,
      gamma: 0,
      vega: 0,
    };
  }

  const sigmaRaizT = volatilidad * Math.sqrt(anios);
  const d1 = (Math.log(futuro / strike) + 0.5 * sigmaRaizT ** 2) / sigmaRaizT;
  const d2 = d1 - sigmaRaizT;

  const primaUsdTm =
    tipo === "call"
      ? descuento * (futuro * normalAcumulada(d1) - strike * normalAcumulada(d2))
      : descuento * (strike * normalAcumulada(-d2) - futuro * normalAcumulada(-d1));

  const delta =
    tipo === "call"
      ? descuento * normalAcumulada(d1)
      : -descuento * normalAcumulada(-d1);

  const gamma = (descuento * densidadNormal(d1)) / (futuro * sigmaRaizT);
  const vega = futuro * descuento * densidadNormal(d1) * Math.sqrt(anios);

  return {
    primaUsdTm,
    primaUsdContrato: primaUsdTm * CC_TONELADAS_POR_CONTRATO,
    delta,
    gamma,
    vega,
  };
}

/**
 * Strike redondeado al múltiplo de 25 USD/TM más cercano, que es como
 * cotizan en la práctica las series de opciones del CC.
 */
export function redondearStrike(precio: number, paso = 25): number {
  return Math.round(precio / paso) * paso;
}

/**
 * Busca el strike del call que deja el collar lo más cerca posible de
 * costo cero, dado un put ya elegido.
 *
 * El collar sin costo es la estructura que más piden los exportadores:
 * financia el piso vendiendo el techo, sin desembolso inicial. Como los
 * strikes cotizan en múltiplos discretos, el costo exacto cero casi
 * nunca existe: se recorre la rejilla y se devuelve el strike que
 * minimiza la prima neta en valor absoluto, que puede quedar en un
 * débito o un crédito pequeño.
 */
export function strikeCollarCostoCero(
  parametrosPut: ParametrosOpcion,
  supuestos: Pick<Supuestos, "tasaLibreRiesgo">,
  paso = 25,
): { strikeCall: number; primaNetaUsdTm: number } {
  const primaPut = valorarOpcion("put", parametrosPut).primaUsdTm;

  const base = {
    futuro: parametrosPut.futuro,
    anios: parametrosPut.anios,
    volatilidad: parametrosPut.volatilidad,
    tasa: supuestos.tasaLibreRiesgo,
  };

  // La prima del call decrece monótonamente con el strike, así que basta
  // barrer desde el dinero hacia arriba. El techo del rango (3× el
  // futuro) acota el barrido sin recortar ningún caso realista.
  const desde = redondearStrike(parametrosPut.futuro, paso);
  const hasta = redondearStrike(parametrosPut.futuro * 3, paso);

  let mejorStrike = desde;
  let mejorNeta = primaPut - valorarOpcion("call", { ...base, strike: desde }).primaUsdTm;

  for (let strike = desde + paso; strike <= hasta; strike += paso) {
    const primaCall = valorarOpcion("call", { ...base, strike }).primaUsdTm;
    const neta = primaPut - primaCall;

    if (Math.abs(neta) < Math.abs(mejorNeta)) {
      mejorStrike = strike;
      mejorNeta = neta;
    }

    // Pasado el punto de cruce la prima del call solo sigue cayendo, así
    // que la prima neta ya no puede acercarse más a cero.
    if (neta > 0 && Math.abs(neta) > Math.abs(mejorNeta)) break;
  }

  return { strikeCall: mejorStrike, primaNetaUsdTm: mejorNeta };
}
