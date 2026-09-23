/**
 * La posición de toda la empresa, mes a mes.
 *
 * El análisis de un lote responde «¿cómo cubro ESTE cacao?». El
 * exportador no piensa así: tiene cacao en bodega, ventas a precio
 * pactado y ventas por fijar contra Nueva York, con embarques en meses
 * distintos. Esas piezas se compensan entre sí —el inventario que ya
 * tiene abastece una venta pactada y su riesgo de precio desaparece—, y
 * cubrirlas por separado duplicaría contratos que se anulan.
 *
 * El módulo hace tres cosas:
 *
 *   1. Asigna la bodega a las ventas por orden de embarque. Lo que la
 *      bodega no alcanza a cubrir hay que comprarlo, y lo que sobra queda
 *      sin vender.
 *   2. Calcula la exposición neta a Nueva York de cada mes, en toneladas,
 *      y la cobertura en contratos que la compensa, con el vencimiento
 *      que corresponde a ese embarque.
 *   3. Simula todos los meses sobre UNA misma trayectoria de precio y
 *      TRM. Así el riesgo de cada mes es el suyo, y el del total refleja
 *      lo que de verdad se compensa entre meses: el percentil 5 del total
 *      no es la suma de los percentiles 5.
 *
 * Mes a mes y no con una fecha promedio porque así lo pidió el cliente,
 * y con razón: una compra de marzo y una venta de noviembre no se
 * compensan aunque sumen cero toneladas. Entre una y otra el precio se
 * mueve, y cada una necesita su propio vencimiento.
 */

import { CC_MESES_VENCIMIENTO, CC_TONELADAS_POR_CONTRATO, KG_POR_TONELADA } from "./constantes";
import { dimensionarCobertura, type AlternativaCobertura } from "./contratos";
import { desviacionBaseUsdTm } from "./montecarlo";
import { crearPrng, media, parNormalEstandar, percentil } from "./numerico";
import { diasAAnios } from "./volatilidad";
import type { Mercado, SentidoCobertura, Supuestos } from "./tipos";

// ---------------------------------------------------------------------
// Diferenciales
// ---------------------------------------------------------------------

/**
 * Un diferencial frente a Nueva York, en cualquiera de sus dos formas.
 *
 * `fraccion` va como en el resto del motor: −0,05 = 5 % por debajo.
 */
export type Diferencial =
  | { tipo: "usd_tm"; valor: number }
  | { tipo: "fraccion"; valor: number };

/** Precio del físico a un nivel de futuro dado, USD/TM. */
export function precioConDiferencial(futuroUsdTm: number, d: Diferencial): number {
  return d.tipo === "fraccion" ? futuroUsdTm * (1 + d.valor) : futuroUsdTm + d.valor;
}

/**
 * Cuántos dólares se mueve el físico por cada dólar del futuro.
 *
 * Con diferencial en USD/TM, uno a uno. En porcentaje, (1 + fracción):
 * quien vende un 5 % por debajo solo está expuesto al 95 % del
 * movimiento, y cubrir el 100 % de las toneladas sería especular.
 */
export function factorDiferencial(d: Diferencial): number {
  return d.tipo === "fraccion" ? 1 + d.valor : 1;
}

// ---------------------------------------------------------------------
// Fechas y vencimientos
// ---------------------------------------------------------------------

const MS_DIA = 86_400_000;

function fechaUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function aIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Días calendario entre dos fechas ISO. Sin reloj del sistema: ambas se reciben. */
export function diasEntre(desdeIso: string, hastaIso: string): number {
  return Math.round((fechaUtc(hastaIso).getTime() - fechaUtc(desdeIso).getTime()) / MS_DIA);
}

function esHabil(fecha: Date): boolean {
  const dia = fecha.getUTCDay();
  return dia !== 0 && dia !== 6;
}

/**
 * Primer día de aviso de un vencimiento CC: diez días hábiles antes del
 * primer día hábil del mes de entrega.
 *
 * Aproximado: cuenta solo fines de semana, no los festivos de ICE. El
 * error es de uno o dos días, y la regla que lo usa deja margen.
 */
export function primerDiaAviso(anio: number, mes: number): string {
  const fecha = new Date(Date.UTC(anio, mes - 1, 1));
  while (!esHabil(fecha)) fecha.setUTCDate(fecha.getUTCDate() + 1);

  let restantes = 10;
  while (restantes > 0) {
    fecha.setUTCDate(fecha.getUTCDate() - 1);
    if (esHabil(fecha)) restantes--;
  }
  return aIso(fecha);
}

export interface VencimientoCC {
  /** «Z26». */
  codigo: string;
  /** «CCZ26», como lo nombran el bróker y las series importadas. */
  simbolo: string;
  /** «diciembre 2026». */
  nombre: string;
  primerAviso: string;
}

/**
 * El vencimiento con el que se cubre un embarque.
 *
 * Es el primero cuyo primer día de aviso cae DESPUÉS del embarque: la
 * posición tiene que poder seguir abierta hasta que se fije el físico, y
 * pasado el primer aviso quien está corto puede terminar entregando
 * cacao en Nueva York. Un embarque del 20 de febrero ya no alcanza el
 * marzo —su aviso es a mediados de febrero— y va contra mayo.
 */
export function vencimientoParaEmbarque(fechaIso: string): VencimientoCC {
  const fecha = fechaUtc(fechaIso);
  for (let anio = fecha.getUTCFullYear(); anio <= fecha.getUTCFullYear() + 2; anio++) {
    for (const m of CC_MESES_VENCIMIENTO) {
      const aviso = primerDiaAviso(anio, m.mes);
      if (aviso > fechaIso) {
        const codigo = `${m.codigo}${String(anio).slice(-2)}`;
        return { codigo, simbolo: `CC${codigo}`, nombre: `${m.nombre} ${anio}`, primerAviso: aviso };
      }
    }
  }
  // Inalcanzable: siempre hay un vencimiento en los dos años siguientes.
  throw new Error(`No se encontró vencimiento para ${fechaIso}.`);
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «2026-11-15» → «2026-11». */
export function claveMes(fechaIso: string): string {
  return fechaIso.slice(0, 7);
}

/** «2026-11» → «nov 2026». */
export function etiquetaMes(clave: string): string {
  const [anio, mes] = clave.split("-").map(Number);
  return `${MESES_CORTOS[mes - 1]} ${anio}`;
}

// ---------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------

export type ModalidadVenta = "precio_pactado" | "por_fijar";

export interface VentaComprometida {
  id: string;
  comprador: string;
  toneladas: number;
  fechaEmbarque: string;
  modalidad: ModalidadVenta;
  /** Obligatorio con precio pactado. */
  precioUsdTm?: number | null;
  /** Obligatorio por fijar: es el diferencial PACTADO, no flota. */
  diferencial?: Diferencial | null;
}

export interface PosicionEmpresa {
  /** Fecha de hoy, ISO. Se recibe para que el motor no lea el reloj. */
  hoy: string;
  inventario: {
    toneladas: number;
    /** Costo ponderado de bodega. null si la hoja no lo declara. */
    costoCopKg: number | null;
  };
  ventas: VentaComprometida[];
  /** Al que se le compra al productor lo que la bodega no alcanza. */
  diferencialCompra: Diferencial;
  /** Al que se espera vender el cacao que no tiene venta todavía. */
  diferencialVentaLibre: Diferencial;
  /** Cuándo se espera vender ese cacao, ISO. */
  fechaVentaLibre: string;
}

// ---------------------------------------------------------------------
// Asignación de la bodega
// ---------------------------------------------------------------------

/**
 * Una venta ya repartida entre lo que sale de bodega y lo que falta
 * comprar. El cacao sin vender es una partida más, sin comprador.
 */
export interface Partida {
  id: string;
  /** «Cacao sin vender» para el sobrante de bodega. */
  comprador: string;
  tipo: ModalidadVenta | "sin_vender";
  fechaEmbarque: string;
  diasAEmbarque: number;
  toneladas: number;
  deBodega: number;
  porComprar: number;
  precioUsdTm: number | null;
  /** Diferencial de venta: pactado si es por fijar, supuesto si está sin vender. */
  diferencialVenta: Diferencial | null;
  /**
   * Toneladas equivalentes de Nueva York. Positivo = gana si el precio
   * sube (hay que VENDER futuros); negativo = pierde si sube (COMPRAR).
   */
  exposicionTm: number;
}

/**
 * Reparte la bodega entre las ventas, la más próxima primero.
 *
 * El orden importa: el cacao que ya está en bodega es el que se puede
 * embarcar antes. Una venta de noviembre no espera a que llegue cacao
 * mientras la bodega se guarda para una de marzo.
 */
export function asignarBodega(posicion: PosicionEmpresa): Partida[] {
  const ventas = [...posicion.ventas].sort((a, b) =>
    a.fechaEmbarque.localeCompare(b.fechaEmbarque),
  );
  const fCompra = factorDiferencial(posicion.diferencialCompra);
  let enBodega = Math.max(posicion.inventario.toneladas, 0);

  const partidas: Partida[] = ventas.map((v) => {
    const deBodega = Math.min(enBodega, v.toneladas);
    enBodega -= deBodega;
    const porComprar = v.toneladas - deBodega;

    // El ingreso de una venta pactada no se mueve; el de una por fijar se
    // mueve con NY según su diferencial. El costo de lo que falta
    // comprar se mueve siempre, en sentido contrario.
    const exposicionVenta =
      v.modalidad === "por_fijar" && v.diferencial
        ? v.toneladas * factorDiferencial(v.diferencial)
        : 0;

    return {
      id: v.id,
      comprador: v.comprador,
      tipo: v.modalidad,
      fechaEmbarque: v.fechaEmbarque,
      diasAEmbarque: diasEntre(posicion.hoy, v.fechaEmbarque),
      toneladas: v.toneladas,
      deBodega,
      porComprar,
      precioUsdTm: v.modalidad === "precio_pactado" ? (v.precioUsdTm ?? null) : null,
      diferencialVenta: v.modalidad === "por_fijar" ? (v.diferencial ?? null) : null,
      exposicionTm: exposicionVenta - porComprar * fCompra,
    };
  });

  if (enBodega > 1e-9) {
    partidas.push({
      id: "sin_vender",
      comprador: "Cacao sin vender",
      tipo: "sin_vender",
      fechaEmbarque: posicion.fechaVentaLibre,
      diasAEmbarque: diasEntre(posicion.hoy, posicion.fechaVentaLibre),
      toneladas: enBodega,
      deBodega: enBodega,
      porComprar: 0,
      precioUsdTm: null,
      diferencialVenta: posicion.diferencialVentaLibre,
      exposicionTm: enBodega * factorDiferencial(posicion.diferencialVentaLibre),
    });
  }

  return partidas;
}

// ---------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------

export interface RiesgoResumido {
  mediaCop: number;
  p5Cop: number;
  p95Cop: number;
  probabilidadPerdida: number;
}

export interface CoberturaMes {
  sentido: SentidoCobertura;
  contratos: number;
  vencimiento: VencimientoCC;
  alternativa: AlternativaCobertura;
  /** Margen inicial que retiene el bróker, USD. */
  margenInicialUsd: number;
}

export interface MesPosicion {
  /** «2026-11». */
  clave: string;
  etiqueta: string;
  /** Promedio ponderado por toneladas: la fecha a la que se cierra la cobertura. */
  diasAEmbarque: number;
  vencimiento: VencimientoCC;
  partidas: Partida[];
  toneladas: {
    precioPactado: number;
    porFijar: number;
    sinVender: number;
    deBodega: number;
    porComprar: number;
  };
  exposicionTm: number;
  /** Cambio de la utilidad del mes si NY sube un 10 %, sin cubrir, COP. */
  sensibilidad10Cop: number;
  /** null cuando la exposición no alcanza medio contrato. */
  cobertura: CoberturaMes | null;
  sinCubrir: RiesgoResumido;
  cubierto: RiesgoResumido;
}

export interface ResultadoPosicion {
  meses: MesPosicion[];
  totales: {
    toneladasBodega: number;
    toneladasVendidas: number;
    precioPactado: number;
    porFijar: number;
    porComprar: number;
    sinVender: number;
    exposicionTm: number;
    contratosVender: number;
    contratosComprar: number;
    margenInicialUsd: number;
    margenInicialCop: number;
    sinCubrir: RiesgoResumido;
    cubierto: RiesgoResumido;
  };
  /** Contratos por vencimiento: lo que de verdad se le pide al bróker. */
  ordenes: { vencimiento: VencimientoCC; sentido: SentidoCobertura; contratos: number }[];
  advertencias: string[];
  trayectorias: number;
}

// ---------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------

function resumirMuestra(muestra: Float64Array): RiesgoResumido {
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

/** Agrupa las partidas por mes de embarque, en orden cronológico. */
function agruparPorMes(partidas: readonly Partida[]): Map<string, Partida[]> {
  const grupos = new Map<string, Partida[]>();
  const ordenadas = [...partidas].sort((a, b) => a.fechaEmbarque.localeCompare(b.fechaEmbarque));
  for (const p of ordenadas) {
    const clave = claveMes(p.fechaEmbarque);
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(p);
    else grupos.set(clave, [p]);
  }
  return grupos;
}

/**
 * Analiza la posición completa.
 *
 * Supuestos del modelo, deliberados:
 *   - Un solo precio de futuro para todos los vencimientos: la curva de
 *     NY no se modela. Lo que se simula es cuánto se mueve el precio
 *     entre hoy y cada embarque, que es lo que importa para el riesgo.
 *   - El diferencial de una venta por fijar está pactado y no flota. El
 *     de compra al productor y el de la venta aún sin comprador sí
 *     flotan, con la desviación medida del descuento.
 *   - El costo de la bodega ya se pagó y no depende del escenario.
 */
export function analizarPosicion(
  posicion: PosicionEmpresa,
  mercado: Mercado,
  supuestos: Supuestos,
): ResultadoPosicion {
  const advertencias: string[] = [];
  const partidas = asignarBodega(posicion).filter((p) => p.toneladas > 0);

  const vencidas = partidas.filter((p) => p.diasAEmbarque <= 0);
  if (vencidas.length > 0) {
    advertencias.push(
      `${vencidas.length === 1 ? "Una venta tiene" : `${vencidas.length} ventas tienen`} fecha de embarque de hoy o anterior. Si ya se embarcó, archívela en Ventas; si no, corrija la fecha.`,
    );
  }
  if (posicion.inventario.costoCopKg == null && posicion.inventario.toneladas > 0) {
    advertencias.push(
      "La hoja de bodega no declara el costo de compra: la utilidad no descuenta lo que costó ese cacao. El riesgo —cuánto se mueve— sí es correcto.",
    );
  }

  const grupos = agruparPorMes(partidas);
  const sigmaBase = desviacionBaseUsdTm(supuestos, mercado.futuroUsdTm);
  const costoCopTmBodega = (posicion.inventario.costoCopKg ?? 0) * KG_POR_TONELADA;
  const F0 = mercado.futuroUsdTm;

  // --- Definición de cada mes, antes de simular ----------------------
  const definiciones = [...grupos.entries()].map(([clave, ps]) => {
    const toneladas = ps.reduce((a, p) => a + p.toneladas, 0);
    const dias = Math.max(
      0,
      Math.round(ps.reduce((a, p) => a + p.diasAEmbarque * p.toneladas, 0) / toneladas),
    );
    const exposicionTm = ps.reduce((a, p) => a + p.exposicionTm, 0);
    const ultimaFecha = ps[ps.length - 1].fechaEmbarque;
    const vencimiento = vencimientoParaEmbarque(ultimaFecha);

    // Sentido opuesto a la exposición: quien gana si sube se cubre
    // vendiendo, y quien pierde si sube se cubre comprando.
    const sentido: SentidoCobertura = exposicionTm >= 0 ? "corta" : "larga";
    let cobertura: CoberturaMes | null = null;
    if (Math.abs(exposicionTm) > 1e-9) {
      const alternativa = dimensionarCobertura(Math.abs(exposicionTm), 1, sentido).recomendada;
      if (alternativa.contratos > 0) {
        cobertura = {
          sentido,
          contratos: alternativa.contratos,
          vencimiento,
          alternativa,
          margenInicialUsd: alternativa.contratos * supuestos.margenInicialUsd,
        };
      }
    }

    return { clave, partidas: ps, dias, exposicionTm, vencimiento, cobertura };
  });

  // --- Simulación sobre una trayectoria común -------------------------
  //
  // Los instantes se recorren en orden y cada uno avanza el precio y la
  // TRM desde el anterior. Así dos meses comparten el camino hasta el
  // primero de ellos, que es lo que los correlaciona de verdad.
  const n = Math.max(2, supuestos.trayectoriasMc - (supuestos.trayectoriasMc % 2));
  const prng = crearPrng(supuestos.semillaMc);
  const rho = Math.max(-1, Math.min(1, supuestos.correlacionPrecioTrm));
  const complemento = Math.sqrt(1 - rho ** 2);

  const instantes = [...new Set(partidas.map((p) => Math.max(p.diasAEmbarque, 0)).concat(definiciones.map((d) => d.dias)))].sort(
    (a, b) => a - b,
  );
  const indiceInstante = new Map(instantes.map((d, i) => [d, i]));

  const sinCubrir = definiciones.map(() => new Float64Array(n));
  const cubierto = definiciones.map(() => new Float64Array(n));
  const totalSin = new Float64Array(n);
  const totalCon = new Float64Array(n);

  const futuros = new Float64Array(instantes.length);
  const trms = new Float64Array(instantes.length);

  const simular = (choquesPrecio: number[], choquesTrm: number[], choquesBase: number[], k: number) => {
    let logF = 0;
    let logT = 0;
    let tAnterior = 0;
    for (let i = 0; i < instantes.length; i++) {
      const dt = diasAAnios(instantes[i]) - tAnterior;
      tAnterior += dt;
      const sP = mercado.volAnualizada * Math.sqrt(Math.max(dt, 0));
      const sT = mercado.volTrmAnualizada * Math.sqrt(Math.max(dt, 0));
      const z1 = choquesPrecio[i];
      const z2 = rho * z1 + complemento * choquesTrm[i];
      logF += -0.5 * sP ** 2 + sP * z1;
      logT += -0.5 * sT ** 2 + sT * z2;
      futuros[i] = F0 * Math.exp(logF);
      trms[i] = mercado.trm * Math.exp(logT);
    }

    let sumaSin = 0;
    let sumaCon = 0;
    definiciones.forEach((def, m) => {
      // El descuento del mercado colombiano revierte a su media: un
      // choque por mes, sin acumularse con el tiempo.
      const choqueBase = sigmaBase * choquesBase[m];
      let utilidad = 0;
      for (const p of def.partidas) {
        const i = indiceInstante.get(Math.max(p.diasAEmbarque, 0))!;
        const F = futuros[i];
        const trm = trms[i];
        const ingresoUsd =
          p.tipo === "precio_pactado"
            ? p.toneladas * (p.precioUsdTm ?? 0)
            : p.tipo === "por_fijar"
              ? p.toneladas * precioConDiferencial(F, p.diferencialVenta!)
              : // Sin comprador: el diferencial de venta no está pactado y flota.
                p.toneladas * (precioConDiferencial(F, p.diferencialVenta!) + choqueBase);
        const costoUsd =
          p.porComprar * (precioConDiferencial(F, posicion.diferencialCompra) + choqueBase);
        utilidad += (ingresoUsd - costoUsd) * trm - p.deBodega * costoCopTmBodega;
      }

      let cobertura = 0;
      if (def.cobertura) {
        const i = indiceInstante.get(def.dias)!;
        const tm = def.cobertura.contratos * CC_TONELADAS_POR_CONTRATO;
        const movimiento = futuros[i] - F0;
        const resultadoUsd =
          (def.cobertura.sentido === "corta" ? -movimiento : movimiento) * tm -
          def.cobertura.contratos * supuestos.comisionUsdContrato;
        cobertura = resultadoUsd * trms[i];
      }

      sinCubrir[m][k] = utilidad;
      cubierto[m][k] = utilidad + cobertura;
      sumaSin += utilidad;
      sumaCon += utilidad + cobertura;
    });
    totalSin[k] = sumaSin;
    totalCon[k] = sumaCon;
  };

  const normales = (cuantas: number): number[] => {
    const salida: number[] = [];
    while (salida.length < cuantas) salida.push(...parNormalEstandar(prng));
    return salida.slice(0, cuantas);
  };
  const negar = (xs: number[]) => xs.map((x) => -x);

  // Variables antitéticas, como en el Monte Carlo del lote: cada
  // trayectoria con su reflejo, para que la media de los choques sea cero.
  for (let k = 0; k < n; k += 2) {
    const zP = normales(instantes.length);
    const zT = normales(instantes.length);
    const zB = normales(definiciones.length);
    simular(zP, zT, zB, k);
    simular(negar(zP), negar(zT), negar(zB), k + 1);
  }

  // --- Ensamblado ------------------------------------------------------
  const meses: MesPosicion[] = definiciones.map((def, m) => {
    const t = (tipo: Partida["tipo"]) =>
      def.partidas.filter((p) => p.tipo === tipo).reduce((a, p) => a + p.toneladas, 0);
    return {
      clave: def.clave,
      etiqueta: etiquetaMes(def.clave),
      diasAEmbarque: def.dias,
      vencimiento: def.vencimiento,
      partidas: def.partidas,
      toneladas: {
        precioPactado: t("precio_pactado"),
        porFijar: t("por_fijar"),
        sinVender: t("sin_vender"),
        deBodega: def.partidas.reduce((a, p) => a + p.deBodega, 0),
        porComprar: def.partidas.reduce((a, p) => a + p.porComprar, 0),
      },
      exposicionTm: def.exposicionTm,
      sensibilidad10Cop: def.exposicionTm * F0 * 0.1 * mercado.trm,
      cobertura: def.cobertura,
      sinCubrir: resumirMuestra(sinCubrir[m]),
      cubierto: resumirMuestra(cubierto[m]),
    };
  });

  // Por vencimiento: dos meses que caen en el mismo contrato se le piden
  // al bróker en una sola orden, y dos en sentido contrario se netean —en
  // la misma cuenta, ICE los compensaría de todos modos—.
  //
  // Netear no pierde cobertura. Con una compra de octubre (largo 2) y una
  // venta de noviembre (corto 3) sobre el mismo diciembre, abrir corto 1
  // hoy y vender 2 más en octubre, al abastecerse, da exactamente el
  // mismo resultado que las dos posiciones por separado: hasta octubre
  // las dos exposiciones se compensan de verdad.
  const porVencimiento = new Map<string, { vencimiento: VencimientoCC; neto: number }>();
  for (const mes of meses) {
    if (!mes.cobertura) continue;
    const signo = mes.cobertura.sentido === "corta" ? -1 : 1;
    const actual = porVencimiento.get(mes.cobertura.vencimiento.codigo);
    if (actual) actual.neto += signo * mes.cobertura.contratos;
    else
      porVencimiento.set(mes.cobertura.vencimiento.codigo, {
        vencimiento: mes.cobertura.vencimiento,
        neto: signo * mes.cobertura.contratos,
      });
  }
  const ordenes = [...porVencimiento.values()]
    .filter((o) => o.neto !== 0)
    .sort((a, b) => a.vencimiento.primerAviso.localeCompare(b.vencimiento.primerAviso))
    .map((o) => ({
      vencimiento: o.vencimiento,
      sentido: (o.neto < 0 ? "corta" : "larga") as SentidoCobertura,
      contratos: Math.abs(o.neto),
    }));

  const suma = (f: (m: MesPosicion) => number) => meses.reduce((a, m) => a + f(m), 0);
  const contratosVender = ordenes.filter((o) => o.sentido === "corta").reduce((a, o) => a + o.contratos, 0);
  const contratosComprar = ordenes.filter((o) => o.sentido === "larga").reduce((a, o) => a + o.contratos, 0);
  const margenInicialUsd = (contratosVender + contratosComprar) * supuestos.margenInicialUsd;

  const mesesSinContrato = meses.filter(
    (m) => !m.cobertura && Math.abs(m.exposicionTm) >= 1,
  );
  if (mesesSinContrato.length > 0) {
    advertencias.push(
      `En ${mesesSinContrato.map((m) => m.etiqueta).join(", ")} la exposición no llega a medio contrato (5 TM): no hay cobertura en bolsa que la calce y queda abierta.`,
    );
  }

  return {
    meses,
    totales: {
      toneladasBodega: posicion.inventario.toneladas,
      toneladasVendidas: posicion.ventas.reduce((a, v) => a + v.toneladas, 0),
      precioPactado: suma((m) => m.toneladas.precioPactado),
      porFijar: suma((m) => m.toneladas.porFijar),
      porComprar: suma((m) => m.toneladas.porComprar),
      sinVender: suma((m) => m.toneladas.sinVender),
      exposicionTm: suma((m) => m.exposicionTm),
      contratosVender,
      contratosComprar,
      margenInicialUsd,
      margenInicialCop: margenInicialUsd * mercado.trm,
      sinCubrir: resumirMuestra(totalSin),
      cubierto: resumirMuestra(totalCon),
    },
    ordenes,
    advertencias,
    trayectorias: n,
  };
}
