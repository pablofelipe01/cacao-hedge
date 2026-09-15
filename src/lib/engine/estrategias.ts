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
import { dimensionarCobertura, type AlternativaCobertura } from "./contratos";
import { resultadoForwardCop } from "./forward-fx";
import {
  costoAdquisicionCop,
  diferencialEnEscenarioUsdTm,
  precioFisicoUsdTm,
  precioVentaPactadoUsdTm,
  toneladasExpuestasAlPrecio,
} from "./fx";
import {
  payoffOpcion,
  redondearStrike,
  strikeCollarCostoCero,
  strikeCollarInversoCostoCero,
  valorarOpcion,
} from "./opciones";
import { diasAAnios } from "./volatilidad";
import { sentidoDe } from "./tipos";
import type {
  Escenario,
  Estrategia,
  Lote,
  Mercado,
  ResultadoEscenario,
  ResumenEstrategia,
  SentidoCobertura,
  Supuestos,
  TipoOperacion,
} from "./tipos";

/** Situación por defecto: inventario en bodega pendiente de venta. */
export function operacionDe(lote: Pick<Lote, "tipoOperacion">): TipoOperacion {
  return lote.tipoOperacion ?? "inventario_sin_vender";
}

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
 *
 * El sentido de la posición lo decide `estrategia.sentido`: una cobertura
 * corta gana cuando el precio cae —protege a quien tiene inventario— y
 * una larga gana cuando sube, protegiendo a quien todavía debe comprar.
 * Es el mismo payoff con el signo invertido.
 */
export function resultadoCoberturaUsd(
  estrategia: Estrategia,
  futuroInicial: number,
  escenario: Escenario,
): number {
  const { toneladasCubiertas, sentido } = estrategia;
  const F1 = escenario.futuroUsdTm;

  switch (estrategia.tipo) {
    case "sin_cobertura":
      return 0;

    // Corta: vende futuros y gana cuando el precio cae, que es cuando el
    // inventario vale menos. Larga: los compra y gana cuando sube, que es
    // cuando la compra pendiente se encarece.
    case "futuros":
      return sentido === "corta"
        ? (futuroInicial - F1) * toneladasCubiertas
        : (F1 - futuroInicial) * toneladasCubiertas;

    // Pone piso al precio de venta.
    case "put_protector":
      return (
        payoffOpcion("put", F1, estrategia.strikePut!) * toneladasCubiertas
      );

    // Pone techo al precio de compra.
    case "call_protector":
      return (
        payoffOpcion("call", F1, estrategia.strikeCall!) * toneladasCubiertas
      );

    // Collar: el piso del put se financia cediendo el techo del call.
    case "collar":
      return (
        (payoffOpcion("put", F1, estrategia.strikePut!) -
          payoffOpcion("call", F1, estrategia.strikeCall!)) *
        toneladasCubiertas
      );

    // Collar inverso: el techo del call se financia cediendo el piso del
    // put. Acota lo que pagará de más y renuncia a la rebaja si el precio
    // cae por debajo del piso.
    case "collar_inverso":
      return (
        (payoffOpcion("call", F1, estrategia.strikeCall!) -
          payoffOpcion("put", F1, estrategia.strikePut!)) *
        toneladasCubiertas
      );

    case "escalonada": {
      const medio = precioMedioEscalonado(
        futuroInicial,
        F1,
        estrategia.tramos!,
      );
      return sentido === "corta"
        ? (medio - F1) * toneladasCubiertas
        : (F1 - medio) * toneladasCubiertas;
    }
  }
}

/** Comisiones de ida y vuelta de la estrategia, en USD. */
export function comisionesUsd(
  estrategia: Estrategia,
  supuestos: Supuestos,
): number {
  // Los collares son dos patas de opción; el resto, una sola posición.
  const patas =
    estrategia.tipo === "collar" || estrategia.tipo === "collar_inverso"
      ? 2
      : 1;
  return estrategia.contratos * supuestos.comisionUsdContrato * patas;
}

/**
 * Evalúa una estrategia en un escenario concreto.
 *
 * Las dos situaciones comparten una sola cuenta: margen = ingreso − costo
 * + cobertura − comisiones. Lo que cambia es cuál de los dos lados flota.
 *
 *  - Inventario sin vender: el costo de adquisición ya se pagó y es un
 *    número fijo en pesos; el ingreso depende de dónde termine el futuro.
 *  - Venta sin comprar: el ingreso está pactado y es fijo en dólares; el
 *    costo de comprarle al productor depende de dónde termine el futuro.
 *
 * En ambos casos la cobertura empuja en sentido contrario al lado que
 * flota, y por eso una sola fórmula sirve para los dos.
 */
export function evaluarEnEscenario(
  estrategia: Estrategia,
  lote: Lote,
  mercado: Mercado,
  escenario: Escenario,
  supuestos: Supuestos,
): ResultadoEscenario {
  const esInventario = operacionDe(lote) === "inventario_sin_vender";

  // Precio del físico en el escenario: al que vende si tiene inventario,
  // al que compra si tiene una venta cerrada pendiente de abastecer.
  const precioFisico = precioFisicoUsdTm(
    lote,
    escenario.futuroUsdTm,
    escenario.diferencialUsdTm,
  );

  const ingresoFisicoUsd = esInventario
    ? lote.toneladas * precioFisico
    : lote.toneladas * precioVentaPactadoUsdTm(lote);

  // El cacao en bodega ya se pagó: su costo no depende del escenario y
  // vive aparte, en pesos. El que falta por comprar sí flota.
  const costoFisicoUsd = esInventario ? 0 : lote.toneladas * precioFisico;
  const costoLoteCop = esInventario
    ? costoAdquisicionCop(lote.toneladas, lote.costoCopKg)
    : 0;

  const coberturaUsd = resultadoCoberturaUsd(
    estrategia,
    mercado.futuroUsdTm,
    escenario,
  );
  const comisiones = comisionesUsd(estrategia, supuestos);
  const primas = estrategia.costoInicialUsd;

  const margenUsd =
    ingresoFisicoUsd - costoFisicoUsd + coberturaUsd - comisiones;

  // Lo que ocurre en el embarque se convierte a la TRM del escenario;
  // las primas ya se pagaron hoy, a la TRM vigente.
  //
  // El forward cambiario se suma aparte y en pesos: por los dólares
  // vendidos a plazo se recibe la tasa pactada en vez de la del día, y la
  // diferencia es lo que aporta —o cuesta— la cobertura.
  const fx = estrategia.coberturaFx;
  const resultadoFxCop = fx
    ? resultadoForwardCop(fx.notionalUsd, fx.tasaForward, escenario.trm)
    : 0;

  const ingresoNetoCop =
    margenUsd * escenario.trm - primas * mercado.trm + resultadoFxCop;
  const utilidadCop = ingresoNetoCop - costoLoteCop;

  return {
    escenario,
    precioFisicoUsdTm: precioFisico,
    ingresoFisicoUsd,
    costoFisicoUsd,
    resultadoCoberturaUsd: coberturaUsd,
    costosCoberturaUsd: -(comisiones + primas),
    ingresoNetoUsd: margenUsd - primas,
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
      (r) =>
        r.escenario.ejes.precio === 0 &&
        r.escenario.ejes.trm === 0 &&
        r.escenario.ejes.base === 0,
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

/**
 * Strikes del call protector, como fracción del futuro vigente.
 *
 * Espejo de los del put: quien protege una compra pone el techo en el
 * dinero o por encima, no por debajo.
 */
export const STRIKES_CALL = [1, 1.05, 1.1] as const;

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
 * Construye el conjunto de estrategias a comparar.
 *
 * Se bifurca según la situación, porque los instrumentos no son los
 * mismos: quien tiene inventario pone un piso con puts, y quien debe
 * comprar pone un techo con calls. Los futuros y la fijación escalonada
 * existen en ambos casos, en sentidos opuestos.
 *
 * Devuelve siempre el caso sin cobertura primero: es la referencia contra
 * la que se juzga si cubrirse aporta algo.
 */
export function construirEstrategias(
  lote: Lote,
  mercado: Mercado,
  supuestos: Supuestos,
): Estrategia[] {
  const anios = diasAAnios(lote.diasAEmbarque);
  const operacion = operacionDe(lote);
  const sentido: SentidoCobertura = sentidoDe(operacion);
  const esInventario = operacion === "inventario_sin_vender";

  const estrategias: Estrategia[] = [];

  estrategias.push({
    id: "sin_cobertura",
    tipo: "sin_cobertura",
    sentido,
    nombre: "Sin cobertura",
    descripcion: esInventario
      ? "Se conserva el inventario abierto al precio de NY, a la base y a la TRM. Es el punto de comparación."
      : "Se sale a comprar el físico al precio que haya ese día. Es el punto de comparación.",
    ratioCobertura: 0,
    contratos: 0,
    toneladasCubiertas: 0,
    toneladasResiduales: lote.toneladas,
    costoInicialUsd: 0,
  });

  // --- Futuros a distintos ratios ------------------------------------
  //
  // Ratios distintos pueden caer en el mismo número de contratos: con 30,6
  // TM expuestas, el 50 % y el 75 % redondean los dos a 2. No son dos
  // alternativas parecidas, son la MISMA posición, y listarlas dos veces
  // hace creer que hay una decisión que tomar donde no la hay. Se agrupan
  // por contratos y se conserva el ratio más alto de cada grupo, que es el
  // que mejor describe lo que esa posición llega a cubrir.
  const verboFuturos = esInventario ? "Venta" : "Compra";
  const porContratos = new Map<
    number,
    { ratios: number[]; alt: AlternativaCobertura }
  >();

  for (const ratio of RATIOS_FUTUROS) {
    // Sobre las toneladas EXPUESTAS, no sobre las físicas: con diferencial
    // porcentual no son la misma cosa, y cubrir las físicas sobre-cubre.
    const alt = dimensionarCobertura(
      toneladasExpuestasAlPrecio(lote),
      ratio,
    ).recomendada;
    const grupo = porContratos.get(alt.contratos);
    if (grupo) {
      grupo.ratios.push(ratio);
      grupo.alt = alt;
    } else {
      porContratos.set(alt.contratos, { ratios: [ratio], alt });
    }
  }

  for (const { ratios, alt } of porContratos.values()) {
    // Cero contratos es exactamente «sin cobertura», que ya está en la
    // lista. Mostrarlo como una alternativa aparte —con las mismas cifras
    // y un guion en la columna de contratos— sugiere una decisión que no
    // existe. Con 7,65 TM expuestas, cubrir el 50 % redondea a cero.
    if (alt.contratos <= 0) continue;

    const ratio = ratios[ratios.length - 1];
    const etiqueta =
      ratios.length === 1
        ? etiquetaPorcentaje(ratio)
        : `${etiquetaPorcentaje(ratios[0]).replace(" %", "")}–${etiquetaPorcentaje(ratio)}`;

    estrategias.push({
      id: `futuros_${Math.round(ratio * 100)}`,
      tipo: "futuros",
      sentido,
      nombre: `${verboFuturos} de futuros ${etiqueta}`,
      descripcion:
        `${verboFuturos} de ${alt.contratos} contrato(s) CC a ${numero(mercado.futuroUsdTm)} USD/TM. ` +
        `Fija el precio del futuro, no la base. ${alt.exposicionResidual}` +
        (ratios.length > 1
          ? ` Cubrir el ${etiquetaPorcentaje(ratios[0])} o el ${etiquetaPorcentaje(ratio)} da la misma posición: un contrato no se puede partir.`
          : ""),
      ratioCobertura: ratio,
      contratos: alt.contratos,
      toneladasCubiertas: alt.toneladasCubiertas,
      toneladasResiduales: lote.toneladas - alt.toneladasCubiertas,
      costoInicialUsd: 0,
    });
  }

  const dimTotal = dimensionarCobertura(
    toneladasExpuestasAlPrecio(lote),
    1,
  ).recomendada;
  const contratosTotal = dimTotal.contratos;
  const toneladasTotal = dimTotal.toneladasCubiertas;

  const baseOpcion = {
    futuro: mercado.futuroUsdTm,
    anios,
    volatilidad: mercado.volAnualizada,
    tasa: supuestos.tasaLibreRiesgo,
  };

  if (esInventario) {
    // --- Put protector: pone piso al precio de venta -----------------
    for (const fraccion of STRIKES_PUT) {
      const strike = redondearStrike(mercado.futuroUsdTm * fraccion);
      const { primaUsdTm } = valorarOpcion("put", { ...baseOpcion, strike });

      estrategias.push({
        id: `put_${Math.round(fraccion * 100)}`,
        tipo: "put_protector",
        sentido,
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

    // --- Collar de costo cero ----------------------------------------
    const strikePut = redondearStrike(mercado.futuroUsdTm * 0.95);
    const parametrosPut = { ...baseOpcion, strike: strikePut };
    const { strikeCall, primaNetaUsdTm } = strikeCollarCostoCero(
      parametrosPut,
      supuestos,
    );

    estrategias.push({
      id: "collar",
      tipo: "collar",
      sentido,
      nombre: `Collar ${strikePut} / ${strikeCall}`,
      descripcion: `Compra de put a ${numero(strikePut)} financiada con la venta de call a ${numero(strikeCall)} USD/TM. Prima neta ${numero(primaNetaUsdTm, 1)} USD/TM. Acota la caída y renuncia a la subida por encima del techo.`,
      ratioCobertura: 1,
      contratos: contratosTotal,
      toneladasCubiertas: toneladasTotal,
      toneladasResiduales: lote.toneladas - toneladasTotal,
      strikePut,
      strikeCall,
      primaNetaUsdTm,
      costoInicialUsd: primaNetaUsdTm * toneladasTotal,
    });
  } else {
    // --- Call protector: pone techo al precio de compra --------------
    for (const fraccion of STRIKES_CALL) {
      const strike = redondearStrike(mercado.futuroUsdTm * fraccion);
      const { primaUsdTm } = valorarOpcion("call", { ...baseOpcion, strike });

      estrategias.push({
        id: `call_${Math.round(fraccion * 100)}`,
        tipo: "call_protector",
        sentido,
        nombre: `Call protector strike ${strike}`,
        descripcion: `Compra de calls a ${numero(strike)} USD/TM por ${numero(primaUsdTm)} USD/TM. Pone techo a lo que pagará y deja libre la rebaja si el precio cae; la prima es costo hundido.`,
        ratioCobertura: 1,
        contratos: contratosTotal,
        toneladasCubiertas: toneladasTotal,
        toneladasResiduales: lote.toneladas - toneladasTotal,
        strikeCall: strike,
        primaNetaUsdTm: primaUsdTm,
        costoInicialUsd: primaUsdTm * toneladasTotal,
      });
    }

    // --- Collar inverso de costo cero --------------------------------
    const strikeCall = redondearStrike(mercado.futuroUsdTm * 1.05);
    const { strikePut, primaNetaUsdTm } = strikeCollarInversoCostoCero(
      { ...baseOpcion, strike: strikeCall },
      supuestos,
    );

    estrategias.push({
      id: "collar_inverso",
      tipo: "collar_inverso",
      sentido,
      nombre: `Collar inverso ${strikeCall} / ${strikePut}`,
      descripcion: `Compra de call a ${numero(strikeCall)} financiada con la venta de put a ${numero(strikePut)} USD/TM. Prima neta ${numero(primaNetaUsdTm, 1)} USD/TM. Acota lo que pagará de más y renuncia a la rebaja por debajo del piso.`,
      ratioCobertura: 1,
      contratos: contratosTotal,
      toneladasCubiertas: toneladasTotal,
      toneladasResiduales: lote.toneladas - toneladasTotal,
      strikePut,
      strikeCall,
      primaNetaUsdTm,
      costoInicialUsd: primaNetaUsdTm * toneladasTotal,
    });
  }

  // --- Fijación escalonada, en ambos sentidos ------------------------
  //
  // Reparte la posición en tramos, y un contrato no se parte: con menos
  // contratos que tramos el precio medio que calcula el motor es
  // inalcanzable. Recomendar algo que el bróker no puede ejecutar es peor
  // que ofrecer una alternativa menos.
  if (contratosTotal >= TRAMOS_POR_DEFECTO) {
    estrategias.push({
      id: `escalonada_${TRAMOS_POR_DEFECTO}`,
      tipo: "escalonada",
      sentido,
      nombre: `Fijación escalonada en ${TRAMOS_POR_DEFECTO} tramos`,
      descripcion: `${esInventario ? "Venta" : "Compra"} del equivalente a ${contratosTotal} contrato(s) repartida en ${TRAMOS_POR_DEFECTO} fijaciones uniformes hasta el ${esInventario ? "embarque" : "abastecimiento"}. Promedia el precio en vez de apostar a un solo momento.`,
      ratioCobertura: 1,
      contratos: contratosTotal,
      toneladasCubiertas: toneladasTotal,
      toneladasResiduales: lote.toneladas - toneladasTotal,
      tramos: TRAMOS_POR_DEFECTO,
      costoInicialUsd: 0,
    });
  }

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
      diferencialUsdTm: diferencialEnEscenarioUsdTm(lote, futuro),
      etiqueta: `payoff-${i}`,
      ejes: { precio: futuro / mercado.futuroUsdTm - 1, trm: 0, base: 0 },
    };

    return {
      futuro,
      utilidad: evaluarEnEscenario(
        estrategia,
        lote,
        mercado,
        escenario,
        supuestos,
      ).utilidadCop,
    };
  });
}
