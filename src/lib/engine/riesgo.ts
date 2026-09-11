/**
 * Métricas de riesgo: exposición, VaR paramétrico y llamadas de margen.
 */

import { CC_TONELADAS_POR_CONTRATO } from "./constantes";
import { factorZ } from "./numerico";
import { valorarOpcion } from "./opciones";
import { diasAAnios } from "./volatilidad";
import type { Escenario, Estrategia, Lote, Mercado, Supuestos } from "./tipos";

// ---------------------------------------------------------------------
// Exposición
// ---------------------------------------------------------------------

export interface Exposicion {
  /** Valor nominal del inventario al futuro vigente, USD. */
  nominalUsd: number;
  /** El mismo nominal convertido a la TRM vigente, COP. */
  nominalCop: number;
  /** Toneladas expuestas al precio tras aplicar la cobertura (delta). */
  toneladasExpuestas: number;
  /** Exposición al precio del futuro, USD. */
  exposicionPrecioUsd: number;
  /** Exposición cambiaria: todo el ingreso es en USD, USD. */
  exposicionFxUsd: number;
}

/**
 * Delta de la cobertura expresado en toneladas.
 *
 * Positivo si la posición gana cuando el precio sube. Una cobertura corta
 * da delta negativo y compensa el inventario; una larga da delta positivo
 * y compensa la compra pendiente. Sirve para saber cuánta exposición al
 * precio queda viva: un put muy fuera del dinero cubre mucho menos de lo
 * que sugiere su nominal.
 */
export function deltaCoberturaTm(
  estrategia: Estrategia,
  mercado: Mercado,
  supuestos: Supuestos,
  diasAEmbarque: number,
): number {
  const anios = diasAAnios(diasAEmbarque);
  const base = {
    futuro: mercado.futuroUsdTm,
    anios,
    volatilidad: mercado.volAnualizada,
    tasa: supuestos.tasaLibreRiesgo,
  };
  const signo = estrategia.sentido === "corta" ? -1 : 1;

  switch (estrategia.tipo) {
    case "sin_cobertura":
      return 0;

    case "futuros":
      return signo * estrategia.toneladasCubiertas;

    // Solo una fracción del tramo está fijada: el resto sigue flotando.
    case "escalonada": {
      const peso = (estrategia.tramos! - 1) / (2 * estrategia.tramos!);
      return signo * estrategia.toneladasCubiertas * (1 - peso);
    }

    case "put_protector": {
      const { delta } = valorarOpcion("put", { ...base, strike: estrategia.strikePut! });
      return delta * estrategia.toneladasCubiertas;
    }

    case "call_protector": {
      const { delta } = valorarOpcion("call", { ...base, strike: estrategia.strikeCall! });
      return delta * estrategia.toneladasCubiertas;
    }

    case "collar": {
      const deltaPut = valorarOpcion("put", { ...base, strike: estrategia.strikePut! }).delta;
      const deltaCall = valorarOpcion("call", { ...base, strike: estrategia.strikeCall! }).delta;
      return (deltaPut - deltaCall) * estrategia.toneladasCubiertas;
    }

    case "collar_inverso": {
      const deltaCall = valorarOpcion("call", { ...base, strike: estrategia.strikeCall! }).delta;
      const deltaPut = valorarOpcion("put", { ...base, strike: estrategia.strikePut! }).delta;
      return (deltaCall - deltaPut) * estrategia.toneladasCubiertas;
    }
  }
}

/** Exposición viva de un lote bajo una estrategia. */
export function calcularExposicion(
  estrategia: Estrategia,
  lote: Lote,
  mercado: Mercado,
  supuestos: Supuestos,
): Exposicion {
  const nominalUsd = lote.toneladas * mercado.futuroUsdTm;
  const delta = deltaCoberturaTm(estrategia, mercado, supuestos, lote.diasAEmbarque);
  const esInventario =
    (lote.tipoOperacion ?? "inventario_sin_vender") === "inventario_sin_vender";

  /*
   * Posición física en toneladas equivalentes.
   *
   * Con inventario es larga: gana si el precio sube. Con una venta ya
   * cerrada es corta: debe entregar cacao que todavía no compró, así que
   * pierde si el precio sube. Un inventario ya vendido a precio fijo no
   * tiene exposición al futuro, solo cambiaria.
   */
  const fisicoTm = !esInventario
    ? -lote.toneladas
    : lote.tipoContrato === "precio_fijo_usd"
      ? 0
      : lote.toneladas;

  const toneladasExpuestas = fisicoTm + delta;

  // Todo el flujo es en dólares, así que la exposición cambiaria es el
  // valor completo de la operación, se cubra o no el precio.
  const precioVenta =
    lote.precioVentaUsdTm != null && (!esInventario || lote.tipoContrato === "precio_fijo_usd")
      ? lote.precioVentaUsdTm
      : mercado.futuroUsdTm + lote.diferencialUsdTm;

  return {
    nominalUsd,
    nominalCop: nominalUsd * mercado.trm,
    toneladasExpuestas,
    exposicionPrecioUsd: toneladasExpuestas * mercado.futuroUsdTm,
    exposicionFxUsd: lote.toneladas * precioVenta,
  };
}

// ---------------------------------------------------------------------
// VaR paramétrico
// ---------------------------------------------------------------------

export interface ResultadoVar {
  nivelConfianza: number;
  /** Factor z correspondiente al nivel de confianza. */
  z: number;
  /** Horizonte en años hasta el embarque. */
  aniosHorizonte: number;
  /** Volatilidad conjunta del valor en COP al horizonte, decimal. */
  volHorizonte: number;
  /** Pérdida máxima esperada al nivel de confianza, COP. */
  varCop: number;
  /** La misma cifra como fracción del nominal. */
  varPorcentaje: number;
  /** Desagregado: cuánto aporta el precio y cuánto la TRM. */
  aporteCop: { precio: number; tasaCambio: number };
}

/**
 * VaR paramétrico (delta-normal) del ingreso en COP.
 *
 * El ingreso en pesos depende del precio del cacao y de la TRM a la vez.
 * Se combinan sus volatilidades con la correlación supuesta y se escala
 * el resultado al horizonte por la regla de la raíz del tiempo.
 *
 * Limitación conocida y deliberada: el método asume retornos normales y
 * exposición lineal, así que subestima el riesgo de las colas y trata
 * mal la convexidad de las opciones. El Monte Carlo existe justamente
 * para complementar este número, no para repetirlo.
 */
export function varParametrico(
  exposicion: Exposicion,
  mercado: Mercado,
  supuestos: Supuestos,
  diasAEmbarque: number,
): ResultadoVar {
  const anios = diasAAnios(diasAEmbarque);
  const raizT = Math.sqrt(anios);
  const z = factorZ(supuestos.nivelConfianzaVar);

  // Exposiciones llevadas a COP: es la moneda en que el exportador mide.
  const exposicionPrecioCop = Math.abs(exposicion.exposicionPrecioUsd) * mercado.trm;
  const exposicionFxCop = Math.abs(exposicion.exposicionFxUsd) * mercado.trm;

  const sigmaPrecio = mercado.volAnualizada * raizT;
  const sigmaFx = mercado.volTrmAnualizada * raizT;
  const rho = supuestos.correlacionPrecioTrm;

  const aportePrecio = exposicionPrecioCop * sigmaPrecio;
  const aporteFx = exposicionFxCop * sigmaFx;

  const varianza =
    aportePrecio ** 2 + aporteFx ** 2 + 2 * rho * aportePrecio * aporteFx;
  const desviacionCop = Math.sqrt(Math.max(varianza, 0));

  const varCop = z * desviacionCop;

  return {
    nivelConfianza: supuestos.nivelConfianzaVar,
    z,
    aniosHorizonte: anios,
    volHorizonte:
      exposicion.nominalCop > 0 ? desviacionCop / exposicion.nominalCop : 0,
    varCop,
    varPorcentaje: exposicion.nominalCop > 0 ? varCop / exposicion.nominalCop : 0,
    aporteCop: { precio: z * aportePrecio, tasaCambio: z * aporteFx },
  };
}

// ---------------------------------------------------------------------
// Llamadas de margen
// ---------------------------------------------------------------------

export interface AnalisisMargen {
  contratos: number;
  /** Capital inmovilizado al abrir la posición, USD. */
  margenInicialTotalUsd: number;
  margenInicialTotalCop: number;
  margenMantenimientoTotalUsd: number;
  /** Colchón por contrato antes de la primera llamada, USD. */
  colchonPorContratoUsd: number;
  /** Subida del futuro que dispara la primera llamada, USD/TM. */
  movimientoDisparadorUsdTm: number;
  /** Precio del futuro al que se dispara la primera llamada, USD/TM. */
  precioDisparadorUsdTm: number;
  /** Subida relativa equivalente. */
  movimientoDisparadorPorcentaje: number;
  /** Llamada estimada en cada escenario alcista. */
  porEscenario: LlamadaMargen[];
  /** La llamada más grande de la matriz. */
  peorLlamada: LlamadaMargen | null;
}

export interface LlamadaMargen {
  etiqueta: string;
  futuroUsdTm: number;
  /** Pérdida acumulada de la posición corta, USD. */
  perdidaUsd: number;
  hayLlamada: boolean;
  /** Efectivo a reponer para volver al margen inicial, USD. */
  montoUsd: number;
  montoCop: number;
}

/**
 * Estima las llamadas de margen de una posición en futuros.
 *
 * Una posición corta pierde cuando el precio sube; una larga, cuando
 * baja. Esa pérdida no es económica —el físico se mueve a la vez en
 * sentido contrario— pero sí es un desembolso de caja inmediato contra la
 * cámara de compensación. Es el riesgo de liquidez que hunde coberturas
 * por lo demás correctas.
 *
 * Solo aplica a estrategias con futuros: quien compra opciones paga la
 * prima por anticipado y nunca recibe una llamada de margen.
 */
export function analizarMargen(
  estrategia: Estrategia,
  mercado: Mercado,
  supuestos: Supuestos,
  escenarios: readonly Escenario[],
): AnalisisMargen | null {
  const usaFuturosVendidos =
    estrategia.tipo === "futuros" || estrategia.tipo === "escalonada";

  if (!usaFuturosVendidos || estrategia.contratos === 0) return null;

  const { contratos } = estrategia;
  const margenInicialTotalUsd = contratos * supuestos.margenInicialUsd;
  const margenMantenimientoTotalUsd = contratos * supuestos.margenMantenimientoUsd;
  const colchonPorContratoUsd =
    supuestos.margenInicialUsd - supuestos.margenMantenimientoUsd;

  // Cada USD/TM de movimiento en contra cuesta 10 USD por contrato. La
  // dirección adversa depende del sentido: hacia arriba si está corto,
  // hacia abajo si está largo.
  const haciaArriba = estrategia.sentido === "corta";
  const movimientoDisparadorUsdTm = colchonPorContratoUsd / CC_TONELADAS_POR_CONTRATO;
  const precioDisparadorUsdTm =
    mercado.futuroUsdTm + (haciaArriba ? 1 : -1) * movimientoDisparadorUsdTm;

  const porEscenario: LlamadaMargen[] = [];
  const vistos = new Set<number>();

  for (const escenario of escenarios) {
    // La llamada depende solo del precio: se evalúa una vez por nivel.
    if (vistos.has(escenario.futuroUsdTm)) continue;
    vistos.add(escenario.futuroUsdTm);

    const movimiento = haciaArriba
      ? escenario.futuroUsdTm - mercado.futuroUsdTm
      : mercado.futuroUsdTm - escenario.futuroUsdTm;
    const perdidaUsd = Math.max(movimiento * CC_TONELADAS_POR_CONTRATO * contratos, 0);
    const hayLlamada = perdidaUsd > colchonPorContratoUsd * contratos;
    const montoUsd = hayLlamada ? perdidaUsd : 0;

    porEscenario.push({
      etiqueta: `futuro ${escenario.ejes.precio >= 0 ? "+" : ""}${Math.round(escenario.ejes.precio * 100)} %`,
      futuroUsdTm: escenario.futuroUsdTm,
      perdidaUsd,
      hayLlamada,
      montoUsd,
      montoCop: montoUsd * escenario.trm,
    });
  }

  porEscenario.sort((a, b) => a.futuroUsdTm - b.futuroUsdTm);

  const conLlamada = porEscenario.filter((l) => l.hayLlamada);
  const peorLlamada =
    conLlamada.length > 0
      ? conLlamada.reduce((peor, l) => (l.montoUsd > peor.montoUsd ? l : peor))
      : null;

  return {
    contratos,
    margenInicialTotalUsd,
    margenInicialTotalCop: margenInicialTotalUsd * mercado.trm,
    margenMantenimientoTotalUsd,
    colchonPorContratoUsd,
    movimientoDisparadorUsdTm,
    precioDisparadorUsdTm,
    movimientoDisparadorPorcentaje: movimientoDisparadorUsdTm / mercado.futuroUsdTm,
    porEscenario,
    peorLlamada,
  };
}
