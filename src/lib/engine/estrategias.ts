/**
 * Construcción y evaluación de las estrategias de cobertura.
 *
 * Toda estrategia se evalúa con el mismo procedimiento: se calcula el
 * ingreso del físico en el escenario, se le suma el resultado de la
 * cobertura, se le restan primas y comisiones, y se convierte a COP.
 * Así las cinco familias quedan comparables en una sola cifra: la
 * utilidad en pesos.
 *
 * Supuestos de conversión, deliberados:
 *   - Las primas se desembolsan HOY y se convierten a la TRM vigente.
 *   - El ingreso del físico, el resultado de la cobertura y las
 *     comisiones ocurren en el embarque y se convierten a la TRM del
 *     escenario.
 *   - El resultado de los futuros se liquida realmente día a día contra
 *     la cámara, a TRM variables. Modelarlo así exigiría una trayectoria
 *     diaria de la TRM; se consolida en la fecha de embarque, lo que es
 *     estándar en análisis de cobertura y se documenta al usuario.
 */

import { CC_TONELADAS_POR_CONTRATO } from "./constantes";
import { dimensionarCobertura } from "./contratos";
import { costoAdquisicionCop, precioFisicoUsdTm } from "./fx";
import { payoffOpcion, redondearStrike, strikeCollarCostoCero, valorarOpcion } from "./opciones";
import { diasAAnios } from "./volatilidad";
import type {
  Escenario,
  Estrategia,
  Lote,
  Mercado,
  ResultadoEscenario,
  ResumenEstrategia,
  Supuestos,
} from "./tipos";

/**
 * Precio medio de fijación de una venta escalonada en `tramos` tramos
 * repartidos uniformemente entre hoy y el embarque.
 *
 * Supuesto: trayectoria lineal del precio entre F0 y F1. El tramo i se
 * ejecuta en el instante i/k del horizonte, de modo que el promedio es
 * F0 + (F1 − F0)·(k−1)/(2k). Con un solo tramo se reduce a vender todo
 * hoy, es decir a la cobertura con futuros simple.
 */
export function precioMedioEscalonado(
  futuroInicial: number,
  futuroFinal: number,
  tramos: number,
): number {
  if (tramos < 1 || !Number.isInteger(tramos)) {
    throw new Error("Los tramos deben ser un entero mayor o igual a 1.");
  }
  const peso = (tramos - 1) / (2 * tramos);
  return futuroInicial + (futuroFinal - futuroInicial) * peso;
}

/**
 * Resultado de la cobertura en un escenario, en USD, sin primas ni
 * comisiones (que se contabilizan aparte porque su momento de pago y su
 * TRM de conversión son distintos).
 */
export function resultadoCoberturaUsd(
  estrategia: Estrategia,
  futuroInicial: number,
  escenario: Escenario,
): number {
  const { toneladasCubiertas } = estrategia;
  const F1 = escenario.futuroUsdTm;

  switch (estrategia.tipo) {
    case "sin_cobertura":
      return 0;

    // Corto en futuros: gana cuando el precio cae, que es exactamente
    // cuando el físico vale menos.
    case "futuros":
      return (futuroInicial - F1) * toneladasCubiertas;

    case "put_protector":
      return payoffOpcion("put", F1, estrategia.strikePut!) * toneladasCubiertas;

    // Collar: el piso del put se financia cediendo el techo del call.
    case "collar":
      return (
        (payoffOpcion("put", F1, estrategia.strikePut!) -
          payoffOpcion("call", F1, estrategia.strikeCall!)) *
        toneladasCubiertas
      );

    case "escalonada":
      return (
        (precioMedioEscalonado(futuroInicial, F1, estrategia.tramos!) - F1) *
        toneladasCubiertas
      );
  }
}

/** Comisiones de ida y vuelta de la estrategia, en USD. */
export function comisionesUsd(estrategia: Estrategia, supuestos: Supuestos): number {
  // El collar son dos patas de opción; el resto, una sola posición.
  const patas = estrategia.tipo === "collar" ? 2 : 1;
  return estrategia.contratos * supuestos.comisionUsdContrato * patas;
}

/** Evalúa una estrategia en un escenario concreto. */
export function evaluarEnEscenario(
  estrategia: Estrategia,
  lote: Lote,
  mercado: Mercado,
  escenario: Escenario,
  supuestos: Supuestos,
): ResultadoEscenario {
  const precioFisico = precioFisicoUsdTm(
    lote,
    escenario.futuroUsdTm,
    escenario.diferencialUsdTm,
  );
  const ingresoFisicoUsd = lote.toneladas * precioFisico;
  const coberturaUsd = resultadoCoberturaUsd(estrategia, mercado.futuroUsdTm, escenario);
  const comisiones = comisionesUsd(estrategia, supuestos);
  const primas = estrategia.costoInicialUsd;

  // Lo que ocurre en el embarque se convierte a la TRM del escenario;
  // las primas ya se pagaron hoy, a la TRM vigente.
  const ingresoNetoCop =
    (ingresoFisicoUsd + coberturaUsd - comisiones) * escenario.trm -
    primas * mercado.trm;

  const costoLoteCop = costoAdquisicionCop(lote.toneladas, lote.costoCopKg);
  const utilidadCop = ingresoNetoCop - costoLoteCop;

  return {
    escenario,
    precioFisicoUsdTm: precioFisico,
    ingresoFisicoUsd,
    resultadoCoberturaUsd: coberturaUsd,
    costosCoberturaUsd: -(comisiones + primas),
    ingresoNetoUsd: ingresoFisicoUsd + coberturaUsd - comisiones - primas,
    ingresoNetoCop,
    costoAdquisicionCop: costoLoteCop,
    utilidadCop,
    utilidadCopTm: utilidadCop / lote.toneladas,
  };
}

/** Evalúa una estrategia sobre toda la matriz y la resume. */
export function resumirEstrategia(
  estrategia: Estrategia,
  lote: Lote,
  mercado: Mercado,
  escenarios: readonly Escenario[],
  supuestos: Supuestos,
): ResumenEstrategia {
  if (escenarios.length === 0) {
    throw new Error("Se requiere al menos un escenario para resumir.");
  }

  const resultados = escenarios.map((escenario) =>
    evaluarEnEscenario(estrategia, lote, mercado, escenario, supuestos),
  );

  let peorCaso = resultados[0];
  let mejorCaso = resultados[0];
  let suma = 0;

  for (const resultado of resultados) {
    if (resultado.utilidadCop < peorCaso.utilidadCop) peorCaso = resultado;
    if (resultado.utilidadCop > mejorCaso.utilidadCop) mejorCaso = resultado;
    suma += resultado.utilidadCop;
  }

  const casoBase =
    resultados.find(
      (r) => r.escenario.ejes.precio === 0 && r.escenario.ejes.trm === 0 && r.escenario.ejes.base === 0,
    ) ?? resultados[0];

  return {
    estrategia,
    resultados,
    peorCaso,
    mejorCaso,
    casoBase,
    utilidadPromedioCop: suma / resultados.length,
    rangoUtilidadCop: mejorCaso.utilidadCop - peorCaso.utilidadCop,
  };
}

// ---------------------------------------------------------------------
// Catálogo de estrategias
// ---------------------------------------------------------------------

/** Ratios de cobertura con futuros que se comparan por defecto. */
export const RATIOS_FUTUROS = [0.5, 0.75, 1] as const;

/** Strikes del put protector, como fracción del futuro vigente. */
export const STRIKES_PUT = [0.9, 0.95, 1] as const;

/** Tramos por defecto de la fijación escalonada. */
export const TRAMOS_POR_DEFECTO = 4;

function etiquetaPorcentaje(x: number): string {
  return `${Math.round(x * 100)} %`;
}

/** Número con coma decimal, para las descripciones que lee el usuario. */
function numero(valor: number, decimales = 0): string {
  return valor.toLocaleString("es-CO", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/**
 * Construye el conjunto de estrategias a comparar para un lote.
 *
 * Devuelve siempre el caso sin cobertura primero: es la referencia
 * contra la que se juzga si cubrirse aporta algo.
 */
export function construirEstrategias(
  lote: Lote,
  mercado: Mercado,
  supuestos: Supuestos,
): Estrategia[] {
  const anios = diasAAnios(lote.diasAEmbarque);
  const estrategias: Estrategia[] = [];

  estrategias.push({
    id: "sin_cobertura",
    tipo: "sin_cobertura",
    nombre: "Sin cobertura",
    descripcion:
      "Se conserva el inventario abierto al precio de NY, a la base y a la TRM. Es el punto de comparación.",
    ratioCobertura: 0,
    contratos: 0,
    toneladasCubiertas: 0,
    toneladasResiduales: lote.toneladas,
    costoInicialUsd: 0,
  });

  // --- Venta de futuros a distintos ratios --------------------------
  for (const ratio of RATIOS_FUTUROS) {
    const dim = dimensionarCobertura(lote.toneladas, ratio);
    const alt = dim.recomendada;
    estrategias.push({
      id: `futuros_${Math.round(ratio * 100)}`,
      tipo: "futuros",
      nombre: `Venta de futuros ${etiquetaPorcentaje(ratio)}`,
      descripcion: `Venta de ${alt.contratos} contrato(s) CC a ${numero(mercado.futuroUsdTm)} USD/TM. Fija el precio del futuro, no la base. ${alt.exposicionResidual}`,
      ratioCobertura: ratio,
      contratos: alt.contratos,
      toneladasCubiertas: alt.toneladasCubiertas,
      toneladasResiduales: lote.toneladas - alt.toneladasCubiertas,
      costoInicialUsd: 0,
    });
  }

  const dimTotal = dimensionarCobertura(lote.toneladas, 1);
  const contratosTotal = dimTotal.recomendada.contratos;
  const toneladasTotal = dimTotal.recomendada.toneladasCubiertas;

  // --- Put protector a varios strikes -------------------------------
  for (const fraccion of STRIKES_PUT) {
    const strike = redondearStrike(mercado.futuroUsdTm * fraccion);
    const { primaUsdTm } = valorarOpcion("put", {
      futuro: mercado.futuroUsdTm,
      strike,
      anios,
      volatilidad: mercado.volAnualizada,
      tasa: supuestos.tasaLibreRiesgo,
    });

    estrategias.push({
      id: `put_${Math.round(fraccion * 100)}`,
      tipo: "put_protector",
      nombre: `Put protector strike ${strike}`,
      descripcion: `Compra de puts a ${numero(strike)} USD/TM por ${numero(primaUsdTm)} USD/TM. Pone piso al precio y deja libre la subida; la prima es costo hundido.`,
      ratioCobertura: 1,
      contratos: contratosTotal,
      toneladasCubiertas: toneladasTotal,
      toneladasResiduales: lote.toneladas - toneladasTotal,
      strikePut: strike,
      primaNetaUsdTm: primaUsdTm,
      costoInicialUsd: primaUsdTm * toneladasTotal,
    });
  }

  // --- Collar de costo cero -----------------------------------------
  const strikePut = redondearStrike(mercado.futuroUsdTm * 0.95);
  const parametrosPut = {
    futuro: mercado.futuroUsdTm,
    strike: strikePut,
    anios,
    volatilidad: mercado.volAnualizada,
    tasa: supuestos.tasaLibreRiesgo,
  };
  const { strikeCall, primaNetaUsdTm } = strikeCollarCostoCero(parametrosPut, supuestos);

  estrategias.push({
    id: "collar",
    tipo: "collar",
    nombre: `Collar ${strikePut} / ${strikeCall}`,
    descripcion: `Compra de put a ${strikePut} financiada con la venta de call a ${strikeCall} USD/TM. Prima neta ${numero(primaNetaUsdTm, 1)} USD/TM. Acota la caída y renuncia a la subida por encima del techo.`,
    ratioCobertura: 1,
    contratos: contratosTotal,
    toneladasCubiertas: toneladasTotal,
    toneladasResiduales: lote.toneladas - toneladasTotal,
    strikePut,
    strikeCall,
    primaNetaUsdTm,
    costoInicialUsd: primaNetaUsdTm * toneladasTotal,
  });

  // --- Fijación escalonada ------------------------------------------
  estrategias.push({
    id: `escalonada_${TRAMOS_POR_DEFECTO}`,
    tipo: "escalonada",
    nombre: `Fijación escalonada en ${TRAMOS_POR_DEFECTO} tramos`,
    descripcion: `Venta del equivalente a ${contratosTotal} contrato(s) repartida en ${TRAMOS_POR_DEFECTO} fijaciones uniformes hasta el embarque. Promedia el precio en vez de apostar a un solo momento.`,
    ratioCobertura: 1,
    contratos: contratosTotal,
    toneladasCubiertas: toneladasTotal,
    toneladasResiduales: lote.toneladas - toneladasTotal,
    tramos: TRAMOS_POR_DEFECTO,
    costoInicialUsd: 0,
  });

  return estrategias;
}

/** Toneladas que cubre un número de contratos. */
export function toneladasDeContratos(contratos: number): number {
  return contratos * CC_TONELADAS_POR_CONTRATO;
}

/**
 * Curva de resultado de una estrategia frente al precio del futuro.
 *
 * Barre un rango de precios manteniendo el diferencial y la TRM en su
 * valor esperado. Aislar el eje del precio es lo que hace legible la
 * forma de cada estrategia —diagonal, plana, rodilla, meseta—; mover los
 * tres ejes a la vez produciría una maraña que no explica nada. El riesgo
 * de base y el cambiario se leen en la matriz de escenarios, que sí los
 * mueve.
 */
export function curvaPayoff(
  estrategia: Estrategia,
  lote: Lote,
  mercado: Mercado,
  supuestos: Supuestos,
  opciones: { desde?: number; hasta?: number; puntos?: number } = {},
): { futuro: number; utilidad: number }[] {
  const {
    desde = mercado.futuroUsdTm * 0.6,
    hasta = mercado.futuroUsdTm * 1.4,
    puntos = 61,
  } = opciones;

  if (puntos < 2) throw new Error("La curva necesita al menos dos puntos.");

  const paso = (hasta - desde) / (puntos - 1);

  return Array.from({ length: puntos }, (_, i) => {
    const futuro = desde + i * paso;
    const escenario: Escenario = {
      futuroUsdTm: futuro,
      trm: mercado.trm,
      diferencialUsdTm: lote.diferencialUsdTm,
      etiqueta: `payoff-${i}`,
      ejes: { precio: futuro / mercado.futuroUsdTm - 1, trm: 0, base: 0 },
    };

    return {
      futuro,
      utilidad: evaluarEnEscenario(estrategia, lote, mercado, escenario, supuestos).utilidadCop,
    };
  });
}
