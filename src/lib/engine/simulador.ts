/**
 * Casos hipotéticos: una venta que todavía no se ha cerrado, con su plata.
 *
 * El caso que lo motivó, en palabras del cliente: «tengo la oportunidad de
 * vender 300 toneladas a precio fijo, con entregas de 50 a 75 toneladas
 * cada quince días a medida que consiga el cacao; me dan un anticipo del
 * 50 % con cada orden y el otro 50 % contra documentos en puerto; tengo
 * un límite de capital de trabajo».
 *
 * `/posicion` ya sabe cubrir una venta a precio fijo. Lo que no mira es la
 * CAJA, y aquí la caja decide. Cubrir 300 TM con futuros son unos treinta
 * contratos, con su margen inicial retenido desde el primer día; y la
 * cobertura de una venta fija es COMPRADA, así que si el cacao baja llegan
 * llamadas de margen justo cuando el negocio va bien —el cacao que falta
 * comprar sale más barato, pero esa ganancia llega semanas después y la
 * llamada es hoy—. Una cobertura que protege la utilidad pero no cabe en
 * la caja obliga a cerrarla en el peor momento, y deja de ser cobertura.
 *
 * Por eso cada estrategia se evalúa dos veces sobre los mismos caminos
 * simulados del precio y la TRM: cuánto deja (utilidad) y cuánto exige
 * (el punto más bajo de la caja). La que se sugiere es la que más protege
 * sin salirse del capital.
 *
 * Supuestos del modelo, deliberados:
 *   - Un solo precio de futuro para todos los vencimientos, como en la
 *     posición: lo que se simula es cuánto se mueve el precio hasta cada
 *     compra.
 *   - El margen de los futuros se liquida cada semana. Si la cuenta baja
 *     del margen de mantenimiento se repone hasta el inicial; las
 *     ganancias se quedan en la cuenta hasta cerrar. Es el lado prudente:
 *     en la realidad el bróker deja retirar el excedente.
 *   - La opción se vende al comprar el cacao, por su valor intrínseco. Se
 *     pierde el valor temporal que le quede, que también es el lado
 *     prudente.
 *   - Los dólares se convierten a pesos el día que entran o salen, a la
 *     TRM de ese día en el camino simulado.
 */

import { CC_TONELADAS_POR_CONTRATO } from "./constantes";
import {
  diasEntre,
  factorDiferencial,
  precioConDiferencial,
  vencimientoParaEmbarque,
  type Diferencial,
  type RiesgoResumido,
  type VencimientoCC,
} from "./consolidado";
import { desviacionBaseUsdTm } from "./montecarlo";
import { crearPrng, media, parNormalEstandar, percentil } from "./numerico";
import { payoffOpcion, redondearStrike, valorarOpcion } from "./opciones";
import { diasAAnios } from "./volatilidad";
import type { Mercado, Supuestos } from "./tipos";

// ---------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------

export interface EntregaHipotetica {
  /** Entrega en puerto, ISO. Contra ella se pagan los documentos. */
  fecha: string;
  toneladas: number;
}

export interface CasoHipotetico {
  /** Fecha de hoy, ISO. Se recibe para que el motor no lea el reloj. */
  hoy: string;
  precioVentaUsdTm: number;
  entregas: EntregaHipotetica[];
  /** Al que se le compra al productor. */
  diferencialCompra: Diferencial;
  /** Días antes de cada entrega en que se compra y se le paga al productor. */
  diasCompraAntes: number;
  anticipo: {
    /** 0,5 = 50 % del valor de cada entrega. */
    fraccion: number;
    /** Días antes de la entrega en que llega: al emitirse la orden. */
    diasAntesEntrega: number;
  };
  /** Días después de la entrega en que se cobra el saldo contra documentos. */
  diasSaldoDespues: number;
  /** Logística, secado, puerto…, USD/TM, pagados el día de la entrega. */
  costosUsdTm: number;
  /** Capital de trabajo disponible hoy, COP. */
  capitalCop: number;
}

/**
 * Reparte un total en entregas iguales cada tantos días.
 *
 * La última se lleva el resto: 300 TM de a 75 son cuatro entregas justas,
 * pero 300 de a 70 son cuatro de 70 y una de 20, que es como lo haría el
 * exportador.
 */
export function generarEntregas(
  toneladasTotales: number,
  toneladasPorEntrega: number,
  primeraEntrega: string,
  cadaDias: number,
): EntregaHipotetica[] {
  if (!(toneladasTotales > 0) || !(toneladasPorEntrega > 0)) return [];
  const paso = Math.max(1, Math.round(cadaDias));
  const entregas: EntregaHipotetica[] = [];
  let restante = toneladasTotales;
  const inicio = new Date(`${primeraEntrega}T00:00:00Z`);
  // Tope de 52 entregas: un año de quincenas. Evita un bucle absurdo si
  // alguien escribe 300 TM de a 0,01.
  for (let i = 0; restante > 1e-9 && i < 52; i++) {
    const fecha = new Date(inicio);
    fecha.setUTCDate(fecha.getUTCDate() + i * paso);
    const tm = Math.min(toneladasPorEntrega, restante);
    entregas.push({ fecha: fecha.toISOString().slice(0, 10), toneladas: Math.round(tm * 1000) / 1000 });
    restante -= tm;
  }
  return entregas;
}

// ---------------------------------------------------------------------
// Estrategias
// ---------------------------------------------------------------------

export type TipoPlan = "sin_cobertura" | "futuros" | "call" | "call_spread";

export interface PlanCobertura {
  id: string;
  tipo: TipoPlan;
  nombre: string;
  descripcion: string;
  /** Fracción de la exposición que se cubre. */
  ratio: number;
  /** Strike del call comprado, como fracción del futuro de hoy. */
  strikeFactor?: number;
  /** Strike del call vendido en el call spread. */
  techoFactor?: number;
}

/**
 * Las estrategias que se comparan.
 *
 * Todas son COMPRADORAS: la venta a precio fijo pierde si el cacao sube
 * antes de comprarlo. Van de la que más caja exige y más protege (futuros
 * al 100 %) a la que menos exige (el call spread, prima baja y protección
 * con techo), pasando por el call, que cuesta una prima conocida hoy y a
 * cambio no tiene llamadas de margen.
 */
export const PLANES: readonly PlanCobertura[] = [
  {
    id: "sin_cobertura",
    tipo: "sin_cobertura",
    nombre: "Sin cobertura",
    descripcion: "No se toma posición en bolsa. Si el cacao sube antes de comprarlo, el margen se va.",
    ratio: 0,
  },
  {
    id: "futuros_100",
    tipo: "futuros",
    nombre: "Futuros comprados 100 %",
    descripcion:
      "Se compran hoy los contratos de todas las entregas y se venden los de cada una el día que se compra su cacao. Protege todo, pero retiene margen inicial y, si el cacao baja, pide llamadas de margen.",
    ratio: 1,
  },
  {
    id: "futuros_50",
    tipo: "futuros",
    nombre: "Futuros comprados 50 %",
    descripcion: "Lo mismo sobre la mitad: la mitad de la caja y la mitad de la protección.",
    ratio: 0.5,
  },
  {
    id: "call_atm",
    tipo: "call",
    nombre: "Call al precio de hoy",
    descripcion:
      "Se compra el derecho a comprar al precio de hoy. Se paga una prima al inicio y nada más: no hay llamadas de margen. Si el cacao baja, se pierde la prima y se compra más barato.",
    ratio: 1,
    strikeFactor: 1,
  },
  {
    id: "call_105",
    tipo: "call",
    nombre: "Call 5 % arriba",
    descripcion:
      "Igual, pero la protección empieza cuando el cacao sube un 5 %. La prima es menor; los primeros 5 % de subida los absorbe el margen.",
    ratio: 1,
    strikeFactor: 1.05,
  },
  {
    id: "call_spread",
    tipo: "call_spread",
    nombre: "Call spread (hoy a +15 %)",
    descripcion:
      "Se compra el call al precio de hoy y se vende otro 15 % arriba. La prima baja bastante, pero la protección se acaba si el cacao sube más del 15 %.",
    ratio: 1,
    strikeFactor: 1,
    techoFactor: 1.15,
  },
];

// ---------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------

export interface CoberturaEntrega {
  /** Índice de la entrega. */
  entrega: number;
  contratos: number;
  vencimiento: VencimientoCC;
  /** Día en que se cierra: cuando se compra el cacao de esa entrega. */
  fechaCierre: string;
}

export interface ResultadoPlan {
  plan: PlanCobertura;
  porEntrega: CoberturaEntrega[];
  contratos: number;
  strikeUsdTm: number | null;
  techoUsdTm: number | null;
  /** Prima total pagada hoy, USD. */
  primaUsd: number;
  /** Margen inicial retenido hoy, USD. */
  margenInicialUsd: number;
  /** Lo que sale de la caja el primer día por la cobertura, COP. */
  desembolsoHoyCop: number;
  utilidad: RiesgoResumido;
  /** Punto más bajo de la caja durante la operación, COP. */
  cajaMinima: { mediana: number; p5: number };
  /** Probabilidad de que la caja se quede corta en algún momento. */
  probabilidadCajaNegativa: number;
  /** Llamadas de margen acumuladas en el peor 5 %, COP. */
  llamadasMargenP95Cop: number;
  /** El peor 5 % de la caja no baja de cero. */
  cabeEnCapital: boolean;
  /** Saldo de caja por semana: mediana y peor 5 %. */
  caja: { dia: number; fecha: string; mediana: number; p5: number }[];
}

export interface MovimientoCaja {
  fecha: string;
  concepto: string;
  montoCop: number;
  saldoCop: number;
}

export interface ResultadoCaso {
  entregas: (EntregaHipotetica & {
    fechaAnticipo: string;
    fechaCompra: string;
    fechaSaldo: string;
    exposicionTm: number;
  })[];
  toneladas: number;
  /** Utilidad al precio de hoy si nada se mueve, COP y USD/TM. */
  utilidadHoyCop: number;
  margenHoyUsdTm: number;
  /** Nivel de NY por encima del cual la venta pierde, sin cubrir. */
  equilibrioUsdTm: number | null;
  planes: ResultadoPlan[];
  recomendado: string;
  justificacion: string;
  /** Calendario de caja del plan recomendado, al precio de hoy. */
  calendario: MovimientoCaja[];
  advertencias: string[];
  trayectorias: number;
}

// ---------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(dias));
  return d.toISOString().slice(0, 10);
}

function resumir(muestra: Float64Array): RiesgoResumido {
  const ordenada = Array.from(muestra).sort((a, b) => a - b);
  let perdidas = 0;
  for (const u of ordenada) {
    if (u < 0) perdidas++;
    else break;
  }
  return {
    mediaCop: media(ordenada),
    p5Cop: percentil(ordenada, 0.05),
    p95Cop: percentil(ordenada, 0.95),
    probabilidadPerdida: ordenada.length > 0 ? perdidas / ordenada.length : 0,
  };
}

/** Lo que el motor necesita saber de cada plan, ya dimensionado. */
interface PlanPreparado {
  plan: PlanCobertura;
  porEntrega: CoberturaEntrega[];
  contratos: number[];
  strike: number | null;
  techo: number | null;
  primaUsdTm: number[];
  primaUsd: number;
  margenInicialUsd: number;
}

/** Evento de caja de una entrega, en días desde hoy. */
interface Hito {
  dia: number;
  entrega: number;
  tipo: "anticipo" | "compra" | "entrega" | "saldo";
}

/**
 * Valida el caso. Devuelve los problemas en palabras, para mostrarlos
 * tal cual en el formulario.
 */
export function validarCaso(caso: CasoHipotetico): string[] {
  const errores: string[] = [];
  if (!(caso.precioVentaUsdTm > 0)) errores.push("El precio de venta debe ser mayor que cero.");
  if (caso.entregas.length === 0) errores.push("Hace falta al menos una entrega.");
  if (caso.entregas.some((e) => !(e.toneladas > 0))) errores.push("Cada entrega debe tener toneladas.");
  if (caso.entregas.some((e) => !/^\d{4}-\d{2}-\d{2}$/.test(e.fecha))) {
    errores.push("Cada entrega debe tener fecha.");
  }
  if (caso.anticipo.fraccion < 0 || caso.anticipo.fraccion > 1) {
    errores.push("El anticipo debe estar entre 0 % y 100 %.");
  }
  if (caso.diasCompraAntes < 0 || caso.anticipo.diasAntesEntrega < 0 || caso.diasSaldoDespues < 0) {
    errores.push("Los días no pueden ser negativos.");
  }
  if (!(caso.capitalCop >= 0)) errores.push("El capital no puede ser negativo.");
  return errores;
}

/**
 * Simula el caso con todas las estrategias sobre los mismos caminos.
 */
export function simularCaso(
  caso: CasoHipotetico,
  mercado: Mercado,
  supuestos: Supuestos,
  planes: readonly PlanCobertura[] = PLANES,
): ResultadoCaso {
  const errores = validarCaso(caso);
  if (errores.length > 0) throw new Error(errores.join(" "));

  const advertencias: string[] = [];
  const F0 = mercado.futuroUsdTm;
  const T0 = mercado.trm;
  const fCompra = factorDiferencial(caso.diferencialCompra);
  const sigmaBase = desviacionBaseUsdTm(supuestos, F0);

  // --- Calendario de cada entrega --------------------------------------
  const entregas = [...caso.entregas]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((e) => {
      const fechaCompra = sumarDias(e.fecha, -caso.diasCompraAntes);
      return {
        ...e,
        fechaAnticipo: sumarDias(e.fecha, -caso.anticipo.diasAntesEntrega),
        fechaCompra,
        fechaSaldo: sumarDias(e.fecha, caso.diasSaldoDespues),
        exposicionTm: e.toneladas * fCompra,
      };
    });

  const dia = (iso: string) => Math.max(0, diasEntre(caso.hoy, iso));
  const pasadas = entregas.filter((e) => diasEntre(caso.hoy, e.fechaCompra) < 0);
  if (pasadas.length > 0) {
    advertencias.push(
      `${pasadas.length === 1 ? "Una entrega tiene" : `${pasadas.length} entregas tienen`} la compra del cacao antes de hoy: se calcula como si se comprara hoy.`,
    );
  }

  const hitos: Hito[] = entregas.flatMap((e, i) => [
    { dia: dia(e.fechaAnticipo), entrega: i, tipo: "anticipo" as const },
    { dia: dia(e.fechaCompra), entrega: i, tipo: "compra" as const },
    { dia: dia(e.fecha), entrega: i, tipo: "entrega" as const },
    { dia: dia(e.fechaSaldo), entrega: i, tipo: "saldo" as const },
  ]);
  // En un mismo día, primero lo que entra: el anticipo de la orden suele
  // llegar el mismo día en que se le paga al productor, y contarlo después
  // inventaría un hueco de caja que no existe.
  const ordenTipo = { anticipo: 0, saldo: 1, compra: 2, entrega: 3 } as const;
  hitos.sort((a, b) => a.dia - b.dia || ordenTipo[a.tipo] - ordenTipo[b.tipo]);

  const ultimoDia = Math.max(...hitos.map((h) => h.dia));
  // Semanas: es el ritmo al que se revisa el margen, y basta para ver la caja.
  const semanas: number[] = [];
  for (let d = 0; d <= ultimoDia; d += 7) semanas.push(d);
  const instantes = [...new Set([...semanas, ...hitos.map((h) => h.dia), ultimoDia])].sort(
    (a, b) => a - b,
  );
  const indice = new Map(instantes.map((d, i) => [d, i]));
  const hitosPorInstante = instantes.map(() => [] as Hito[]);
  for (const h of hitos) hitosPorInstante[indice.get(h.dia)!].push(h);

  // --- Preparar cada plan ------------------------------------------------
  const tasa = supuestos.tasaLibreRiesgo;
  const preparados: PlanPreparado[] = planes.map((plan) => {
    const strike = plan.strikeFactor ? redondearStrike(F0 * plan.strikeFactor) : null;
    const techo = plan.techoFactor ? redondearStrike(F0 * plan.techoFactor) : null;
    const contratos = entregas.map((e) =>
      plan.ratio > 0 ? Math.round((e.exposicionTm * plan.ratio) / CC_TONELADAS_POR_CONTRATO) : 0,
    );
    const primaUsdTm = entregas.map((e) => {
      if (strike == null) return 0;
      const anios = diasAAnios(dia(e.fechaCompra));
      const params = { futuro: F0, anios, volatilidad: mercado.volAnualizada, tasa };
      const larga = valorarOpcion("call", { ...params, strike }).primaUsdTm;
      const corta = techo != null ? valorarOpcion("call", { ...params, strike: techo }).primaUsdTm : 0;
      return larga - corta;
    });
    const tm = (i: number) => contratos[i] * CC_TONELADAS_POR_CONTRATO;
    const primaUsd = entregas.reduce((a, _e, i) => a + primaUsdTm[i] * tm(i), 0);
    const totalContratos = contratos.reduce((a, c) => a + c, 0);

    return {
      plan,
      porEntrega: entregas.map((e, i) => ({
        entrega: i,
        contratos: contratos[i],
        vencimiento: vencimientoParaEmbarque(e.fechaCompra < caso.hoy ? caso.hoy : e.fechaCompra),
        fechaCierre: e.fechaCompra,
      })),
      contratos,
      strike,
      techo,
      primaUsdTm,
      primaUsd,
      margenInicialUsd: plan.tipo === "futuros" ? totalContratos * supuestos.margenInicialUsd : 0,
    };
  });

  // --- Simulación ----------------------------------------------------------
  const n = Math.max(2, supuestos.trayectoriasMc - (supuestos.trayectoriasMc % 2));
  const prng = crearPrng(supuestos.semillaMc);
  const rho = Math.max(-1, Math.min(1, supuestos.correlacionPrecioTrm));
  const complemento = Math.sqrt(1 - rho ** 2);

  const P = preparados.length;
  const utilidad = preparados.map(() => new Float64Array(n));
  const cajaMin = preparados.map(() => new Float64Array(n));
  const llamadas = preparados.map(() => new Float64Array(n));
  const cajaPorSemana = preparados.map(() => semanas.map(() => new Float64Array(n)));
  const indiceSemana = new Map(semanas.map((d, s) => [d, s]));

  const futuros = new Float64Array(instantes.length);
  const trms = new Float64Array(instantes.length);
  const MI = supuestos.margenInicialUsd;
  const MM = supuestos.margenMantenimientoUsd;
  const comision = supuestos.comisionUsdContrato;

  const simular = (zP: number[], zT: number[], zB: number[], k: number) => {
    let logF = 0;
    let logT = 0;
    let tAnterior = 0;
    for (let i = 0; i < instantes.length; i++) {
      const dt = Math.max(diasAAnios(instantes[i]) - tAnterior, 0);
      tAnterior += dt;
      const sP = mercado.volAnualizada * Math.sqrt(dt);
      const sT = mercado.volTrmAnualizada * Math.sqrt(dt);
      logF += -0.5 * sP ** 2 + sP * zP[i];
      logT += -0.5 * sT ** 2 + sT * (rho * zP[i] + complemento * zT[i]);
      futuros[i] = F0 * Math.exp(logF);
      trms[i] = T0 * Math.exp(logT);
    }

    for (let p = 0; p < P; p++) {
      const pr = preparados[p];
      const esFuturo = pr.plan.tipo === "futuros";
      // Una subcuenta por entrega: se abre hoy y se cierra al comprar su cacao.
      const cuenta = pr.contratos.map((c) => c * MI);
      const abierta = pr.contratos.map((c) => c > 0);
      let caja = caso.capitalCop;
      let llamado = 0;

      // Día cero: margen inicial o prima, a la TRM de hoy.
      caja -= esFuturo ? pr.margenInicialUsd * T0 : pr.primaUsd * T0;
      let minimo = caja;
      let fAnterior = F0;

      for (let i = 0; i < instantes.length; i++) {
        const F = futuros[i];
        const trm = trms[i];

        if (esFuturo) {
          for (let e = 0; e < cuenta.length; e++) {
            if (!abierta[e]) continue;
            const c = pr.contratos[e];
            cuenta[e] += (F - fAnterior) * c * CC_TONELADAS_POR_CONTRATO;
            if (cuenta[e] < c * MM) {
              const reposicion = c * MI - cuenta[e];
              cuenta[e] += reposicion;
              caja -= reposicion * trm;
              llamado += reposicion * trm;
            }
          }
        }
        fAnterior = F;

        for (const h of hitosPorInstante[i]) {
          const e = entregas[h.entrega];
          const valorUsd = e.toneladas * caso.precioVentaUsdTm;
          if (h.tipo === "anticipo") {
            caja += valorUsd * caso.anticipo.fraccion * trm;
          } else if (h.tipo === "saldo") {
            caja += valorUsd * (1 - caso.anticipo.fraccion) * trm;
          } else if (h.tipo === "entrega") {
            caja -= e.toneladas * caso.costosUsdTm * trm;
          } else {
            // Compra del cacao: el precio del día más el descuento, que
            // revierte a su media y se sortea una vez por entrega.
            const precio = precioConDiferencial(F, caso.diferencialCompra) + sigmaBase * zB[h.entrega];
            caja -= e.toneladas * precio * trm;

            // Y se cierra la cobertura de esa entrega.
            const c = pr.contratos[h.entrega];
            if (c > 0) {
              const tm = c * CC_TONELADAS_POR_CONTRATO;
              if (esFuturo) {
                caja += (cuenta[h.entrega] - c * comision) * trm;
                cuenta[h.entrega] = 0;
                abierta[h.entrega] = false;
              } else if (pr.strike != null) {
                let pago = payoffOpcion("call", F, pr.strike);
                if (pr.techo != null) pago -= payoffOpcion("call", F, pr.techo);
                caja += (pago * tm - c * comision) * trm;
              }
            }
          }
        }

        if (caja < minimo) minimo = caja;
        const s = indiceSemana.get(instantes[i]);
        if (s !== undefined) cajaPorSemana[p][s][k] = caja;
      }

      utilidad[p][k] = caja - caso.capitalCop;
      cajaMin[p][k] = minimo;
      llamadas[p][k] = llamado;
    }
  };

  const normales = (cuantas: number): number[] => {
    const salida: number[] = [];
    while (salida.length < cuantas) salida.push(...parNormalEstandar(prng));
    return salida.slice(0, cuantas);
  };
  const negar = (xs: number[]) => xs.map((x) => -x);

  // Variables antitéticas, como en el resto del motor.
  for (let k = 0; k < n; k += 2) {
    const zP = normales(instantes.length);
    const zT = normales(instantes.length);
    const zB = normales(entregas.length);
    simular(zP, zT, zB, k);
    simular(negar(zP), negar(zT), negar(zB), k + 1);
  }

  // --- Ensamblado ------------------------------------------------------------
  const ordenar = (xs: Float64Array) => Array.from(xs).sort((a, b) => a - b);

  const resultados: ResultadoPlan[] = preparados.map((pr, p) => {
    const minimos = ordenar(cajaMin[p]);
    const negativos = minimos.findIndex((v) => v >= 0);
    const p5Caja = percentil(minimos, 0.05);
    return {
      plan: pr.plan,
      porEntrega: pr.porEntrega,
      contratos: pr.contratos.reduce((a, c) => a + c, 0),
      strikeUsdTm: pr.strike,
      techoUsdTm: pr.techo,
      primaUsd: pr.primaUsd,
      margenInicialUsd: pr.margenInicialUsd,
      desembolsoHoyCop: (pr.plan.tipo === "futuros" ? pr.margenInicialUsd : pr.primaUsd) * T0,
      utilidad: resumir(utilidad[p]),
      cajaMinima: { mediana: percentil(minimos, 0.5), p5: p5Caja },
      probabilidadCajaNegativa: (negativos === -1 ? minimos.length : negativos) / minimos.length,
      llamadasMargenP95Cop: percentil(ordenar(llamadas[p]), 0.95),
      cabeEnCapital: p5Caja >= 0,
      caja: semanas.map((d, s) => {
        const col = ordenar(cajaPorSemana[p][s]);
        return { dia: d, fecha: sumarDias(caso.hoy, d), mediana: percentil(col, 0.5), p5: percentil(col, 0.05) };
      }),
    };
  });

  // --- Recomendación -----------------------------------------------------
  //
  // El mismo criterio que el análisis de un lote —el mejor peor 5 % de la
  // utilidad—, pero solo entre las que caben en la caja. Una cobertura que
  // no se puede sostener hasta el final no protege nada.
  const sinCobertura = resultados.find((r) => r.plan.tipo === "sin_cobertura") ?? resultados[0];
  const caben = resultados.filter((r) => r.cabeEnCapital);
  const mejorP5 = (rs: ResultadoPlan[]) =>
    rs.reduce((a, b) => (b.utilidad.p5Cop > a.utilidad.p5Cop ? b : a));

  let recomendado: ResultadoPlan;
  let justificacion: string;
  if (caben.length > 0) {
    recomendado = mejorP5(caben);
    const mejorSinLimite = mejorP5(resultados);
    justificacion =
      recomendado.plan.tipo === "sin_cobertura"
        ? "Ninguna cobertura mejora el peor 5 % de la utilidad sin salirse del capital."
        : `Es la que más mejora el peor 5 % de la utilidad sin que la caja se quede corta en el peor 5 % de los caminos.`;
    if (mejorSinLimite !== recomendado) {
      justificacion += ` «${mejorSinLimite.plan.nombre}» protegería más, pero en el peor 5 % de los caminos pide más caja de la que hay.`;
    }
  } else {
    recomendado = resultados.reduce((a, b) => (b.cajaMinima.p5 > a.cajaMinima.p5 ? b : a));
    justificacion =
      "Con este capital ninguna alternativa —ni siquiera no cubrirse— mantiene la caja positiva en el peor 5 % de los caminos: la operación misma necesita más capital de trabajo o un anticipo mayor. Se muestra la que menos caja exige.";
  }

  const margenHoyUsdTm =
    caso.precioVentaUsdTm - precioConDiferencial(F0, caso.diferencialCompra) - caso.costosUsdTm;
  const toneladas = entregas.reduce((a, e) => a + e.toneladas, 0);
  const equilibrio =
    caso.diferencialCompra.tipo === "fraccion"
      ? (caso.precioVentaUsdTm - caso.costosUsdTm) / fCompra
      : caso.precioVentaUsdTm - caso.costosUsdTm - caso.diferencialCompra.valor;

  if (margenHoyUsdTm <= 0) {
    advertencias.push(
      "Al precio de hoy la venta no deja margen: comprar el cacao y llevarlo a puerto cuesta más de lo que se cobra. Ninguna cobertura arregla eso; solo lo congela.",
    );
  }
  if (sinCobertura.probabilidadCajaNegativa > 0.05) {
    advertencias.push(
      "Aun sin cobertura, la caja se queda corta en más del 5 % de los caminos: los pagos al productor van antes que los cobros. Revise el anticipo, los días o el capital.",
    );
  }

  return {
    entregas,
    toneladas,
    utilidadHoyCop: margenHoyUsdTm * toneladas * T0,
    margenHoyUsdTm,
    equilibrioUsdTm: equilibrio > 0 ? equilibrio : null,
    planes: resultados,
    recomendado: recomendado.plan.id,
    justificacion,
    calendario: calendarioAlPrecioDeHoy(caso, entregas, preparados.find((p) => p.plan.id === recomendado.plan.id)!, mercado, supuestos),
    advertencias,
    trayectorias: n,
  };
}

/**
 * Los movimientos de caja si el precio y la TRM se quedaran quietos.
 *
 * No es un pronóstico: es el esqueleto de la operación, para ver en qué
 * orden entra y sale la plata. El riesgo está en la simulación.
 */
function calendarioAlPrecioDeHoy(
  caso: CasoHipotetico,
  entregas: ResultadoCaso["entregas"],
  plan: PlanPreparado,
  mercado: Mercado,
  supuestos: Supuestos,
): MovimientoCaja[] {
  const T0 = mercado.trm;
  const F0 = mercado.futuroUsdTm;
  const movimientos: { fecha: string; orden: number; concepto: string; montoCop: number }[] = [];
  const hoy = (iso: string) => (iso < caso.hoy ? caso.hoy : iso);

  if (plan.plan.tipo === "futuros" && plan.margenInicialUsd > 0) {
    movimientos.push({
      fecha: caso.hoy,
      orden: 2,
      concepto: `Margen inicial de ${plan.contratos.reduce((a, c) => a + c, 0)} contratos`,
      montoCop: -plan.margenInicialUsd * T0,
    });
  } else if (plan.primaUsd > 0) {
    movimientos.push({ fecha: caso.hoy, orden: 2, concepto: "Prima de las opciones", montoCop: -plan.primaUsd * T0 });
  }

  entregas.forEach((e, i) => {
    const n = i + 1;
    const valor = e.toneladas * caso.precioVentaUsdTm * T0;
    if (caso.anticipo.fraccion > 0) {
      movimientos.push({
        fecha: hoy(e.fechaAnticipo),
        orden: 0,
        concepto: `Anticipo entrega ${n}`,
        montoCop: valor * caso.anticipo.fraccion,
      });
    }
    movimientos.push({
      fecha: hoy(e.fechaCompra),
      orden: 2,
      concepto: `Compra del cacao entrega ${n} (${e.toneladas.toLocaleString("es-CO")} TM)`,
      montoCop: -e.toneladas * precioConDiferencial(F0, caso.diferencialCompra) * T0,
    });
    const c = plan.contratos[i];
    if (plan.plan.tipo === "futuros" && c > 0) {
      movimientos.push({
        fecha: hoy(e.fechaCompra),
        orden: 1,
        concepto: `Cierre de ${c} contratos: vuelve el margen`,
        montoCop: (c * supuestos.margenInicialUsd - c * supuestos.comisionUsdContrato) * T0,
      });
    }
    if (caso.costosUsdTm > 0) {
      movimientos.push({
        fecha: e.fecha,
        orden: 3,
        concepto: `Logística entrega ${n}`,
        montoCop: -e.toneladas * caso.costosUsdTm * T0,
      });
    }
    if (caso.anticipo.fraccion < 1) {
      movimientos.push({
        fecha: e.fechaSaldo,
        orden: 1,
        concepto: `Saldo contra documentos entrega ${n}`,
        montoCop: valor * (1 - caso.anticipo.fraccion),
      });
    }
  });

  movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);
  let saldo = caso.capitalCop;
  return movimientos.map((m) => {
    saldo += m.montoCop;
    return { fecha: m.fecha, concepto: m.concepto, montoCop: m.montoCop, saldoCop: saldo };
  });
}
