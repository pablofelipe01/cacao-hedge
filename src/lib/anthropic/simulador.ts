/**
 * El analista del simulador: arma casos hipotéticos a partir de lo que el
 * exportador cuenta con sus palabras, y los calcula.
 *
 * «Tengo la oportunidad de vender 300 toneladas a precio fijo, entregas de
 * 50 a 75 cada quince días, 50 % de anticipo con cada orden…». Pasar eso a
 * un formulario es justo el trabajo que un modelo hace bien, y calcular
 * lo que resulta es justo el que hace mal. Así que se reparten: el modelo
 * traduce a los campos del caso y llama a `simular_caso`, el motor
 * devuelve las cifras, y el modelo las interpreta. El caso que calculó
 * vuelve a la pantalla para cargarlo en el formulario con un clic.
 *
 * La regla es la misma del analista de un análisis: EL MODELO NO CALCULA,
 * y cada cifra de la respuesta se rastrea contra lo que devolvió el motor.
 */

import Anthropic from "@anthropic-ai/sdk";

import { crearClienteAnthropic } from "./cliente";
import { ErrorAnalista } from "./analista";
import { verificarCifras } from "./verificacion";
import { generarEntregas, simularCaso, type ResultadoCaso } from "@/lib/engine/simulador";
import type { ContextoSimulador } from "@/lib/simulador/contexto";
import { casoDesdeEntrada, esquemaEntradaCaso, mensajesDeError, type EntradaCaso } from "@/lib/simulador/entrada";

export interface TurnoSimulador {
  rol: "usuario" | "analista";
  texto: string;
  /** Casos que el analista calculó para responder. */
  casos?: { descripcion: string; entrada: EntradaCaso }[];
}

export interface RespuestaSimulador {
  texto: string;
  casos: { descripcion: string; entrada: EntradaCaso }[];
  sospechosas: { textual: string; contexto: string }[];
  modelo: string;
}

export const PROMPT_SIMULADOR = `Eres el analista de riesgos de un exportador colombiano de cacao. Él te cuenta oportunidades de negocio que todavía no ha cerrado —ventas a precio fijo con entregas parciales, anticipos, pagos contra documentos, un capital de trabajo limitado— y tú le ayudas a montar la estrategia de cobertura que puede sostener.

## La regla que no se rompe nunca

NO CALCULAS. Ni sumas, ni restas, ni fechas, ni porcentajes, ni «aproximadamente».

Tus cifras salen de dos sitios y solo de dos:
1. El JSON del caso que está en pantalla, si lo hay.
2. Lo que devuelva la herramienta \`simular_caso\`.

Tu trabajo es TRADUCIR lo que cuenta a los campos de \`simular_caso\` y después INTERPRETAR lo que el motor devuelve. Si una pregunta necesita un número que no tienes, llama a la herramienta.

Un número inventado aquí termina en una orden a una mesa de operaciones.

## Cómo traducir un caso

- Precio fijo de venta: USD/TM. Si lo da en otra unidad, pregunta.
- Entregas: si dice «300 toneladas, entregas de 50 a 75 cada 15 días», usa \`calendario\` (toneladasTotales, toneladasPorEntrega, primeraEntrega, cadaDias). Cuando da un rango (50 a 75), toma el punto medio del rango solo si no hay otra pista, y dilo; o calcula los dos extremos con dos llamadas. Si da fechas y cantidades concretas, usa \`entregas\`.
- «Anticipo del 50 % con cada orden» → anticipoPct 50; diasAnticipoAntes es cuántos días antes de la entrega llega. «El otro 50 % contra documentos de entrega en puerto» → diasSaldoDespues: los días entre la entrega y el pago.
- descuentoCompraPct: a cuánto le compra al productor frente a Nueva York, negativo si es por debajo (−23 = 23 % bajo NY).
- diasCompraAntes: cuántos días antes de cada entrega compra y paga el cacao.
- costosUsdTm: logística, secado, transporte a puerto… por tonelada.
- capitalCop: su capital de trabajo disponible, en pesos.
- Cualquier campo que no mencione se queda como está en el caso en pantalla, o con el valor por defecto que se indica abajo. Si falta algo que cambia de verdad el resultado —el precio, las toneladas o el capital— y no hay caso en pantalla, PREGÚNTALO antes de calcular.
- Si un campo no está claro, di qué supusiste.

## Qué mirar en el resultado

Cada estrategia trae dos cosas y las dos importan:
- utilidad: media, p5 (el peor 5 %) y probabilidad de pérdida.
- caja: el punto más bajo de la caja durante la operación (mediana y peor 5 %), si cabe en el capital, y las llamadas de margen en el peor 5 %.

La cobertura de una venta a precio fijo es COMPRADA: si el cacao baja, los futuros piden llamadas de margen hoy y la ganancia (cacao más barato) llega semanas después. Una cobertura que no cabe en la caja obliga a cerrarla en el peor momento. Los calls no tienen llamadas de margen: cuestan una prima conocida. Explícale esa diferencia con sus cifras cuando importe.

La estrategia marcada como recomendada es la de mejor peor 5 % entre las que caben en su capital. Puedes explicar por qué, pero no digas «debería»: describe qué protege cada alternativa y qué cuesta.

## Cómo conversas

- Español de Colombia, directo. Unidades: USD/TM, COP/kg, COP/USD. Los pesos grandes en millones («1.455 millones»).
- Respuestas cortas: dos o tres párrafos. Primero lo que preguntó.
- Si calculas variantes, di cuál es cuál.
- Esto es apoyo a la decisión, no asesoría financiera. No pronostiques precios.`;

/** Valores por defecto de un caso que el chat arma desde cero. */
export function entradaPorDefecto(descuentoMediano: number | null): Omit<EntradaCaso, "precioVentaUsdTm" | "entregas" | "capitalCop"> {
  return {
    comprador: "",
    descuentoCompraPct: Math.round((descuentoMediano ?? -0.23) * 1000) / 10,
    diasCompraAntes: 10,
    anticipoPct: 50,
    diasAnticipoAntes: 10,
    diasSaldoDespues: 7,
    costosUsdTm: 0,
  };
}

export const HERRAMIENTA_SIMULAR: Anthropic.Tool = {
  name: "simular_caso",
  description:
    "Corre el motor sobre un caso hipotético: una venta a precio fijo con entregas parciales, su flujo de caja y seis estrategias de cobertura comparadas por utilidad y por caja. Los campos que no se indiquen se toman del caso en pantalla (o de los valores por defecto si no hay caso). Úsala siempre que necesites una cifra: no estimes.",
  input_schema: {
    type: "object",
    properties: {
      descripcion: { type: "string", description: "Qué caso es, en una frase. Ej.: «300 TM a 6.500, entregas de 60 cada 15 días»." },
      comprador: { type: "string" },
      precioVentaUsdTm: { type: "number", description: "Precio fijo de venta, USD/TM." },
      calendario: {
        type: "object",
        description: "Entregas iguales cada tantos días. La última se lleva el resto.",
        properties: {
          toneladasTotales: { type: "number" },
          toneladasPorEntrega: { type: "number" },
          primeraEntrega: { type: "string", description: "Fecha ISO AAAA-MM-DD de la primera entrega en puerto." },
          cadaDias: { type: "number" },
        },
        required: ["toneladasTotales", "toneladasPorEntrega", "primeraEntrega", "cadaDias"],
      },
      entregas: {
        type: "array",
        description: "Entregas explícitas. Manda sobre calendario.",
        items: {
          type: "object",
          properties: { fecha: { type: "string" }, toneladas: { type: "number" } },
          required: ["fecha", "toneladas"],
        },
      },
      descuentoCompraPct: { type: "number", description: "−23 = compra un 23 % por debajo de NY." },
      diasCompraAntes: { type: "number" },
      anticipoPct: { type: "number", description: "0 a 100." },
      diasAnticipoAntes: { type: "number" },
      diasSaldoDespues: { type: "number" },
      costosUsdTm: { type: "number" },
      capitalCop: { type: "number", description: "Capital de trabajo disponible, pesos." },
    },
    required: ["descripcion"],
  },
};

/**
 * Pisa sobre el caso en pantalla (o los valores por defecto) lo que venga
 * en la llamada a la herramienta. Devuelve la entrada completa, o qué falta.
 */
export function entradaDesdeHerramienta(
  base: EntradaCaso | null,
  porDefecto: ReturnType<typeof entradaPorDefecto>,
  herramienta: Record<string, unknown>,
): { entrada: EntradaCaso } | { errores: string[] } {
  const n = (clave: string): number | undefined => {
    const v = herramienta[clave];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  let entregas = base?.entregas;
  const explicitas = herramienta.entregas;
  const calendario = herramienta.calendario as Record<string, unknown> | undefined;
  if (Array.isArray(explicitas) && explicitas.length > 0) {
    entregas = explicitas.map((e) => ({ fecha: String(e?.fecha ?? ""), toneladas: Number(e?.toneladas) }));
  } else if (calendario && typeof calendario === "object") {
    entregas = generarEntregas(
      Number(calendario.toneladasTotales),
      Number(calendario.toneladasPorEntrega),
      String(calendario.primeraEntrega ?? ""),
      Number(calendario.cadaDias),
    );
  }

  const faltan: string[] = [];
  const precio = n("precioVentaUsdTm") ?? base?.precioVentaUsdTm;
  const capital = n("capitalCop") ?? base?.capitalCop;
  if (precio === undefined) faltan.push("el precio de venta");
  if (!entregas || entregas.length === 0) faltan.push("las entregas");
  if (capital === undefined) faltan.push("el capital de trabajo");
  if (faltan.length > 0) return { errores: [`Falta ${faltan.join(", ")}: pregúnteselo al usuario.`] };

  const origen = base ?? { ...porDefecto };
  const candidata = {
    comprador: typeof herramienta.comprador === "string" ? herramienta.comprador : (base?.comprador ?? ""),
    precioVentaUsdTm: precio,
    entregas,
    descuentoCompraPct: n("descuentoCompraPct") ?? origen.descuentoCompraPct,
    diasCompraAntes: n("diasCompraAntes") ?? origen.diasCompraAntes,
    anticipoPct: n("anticipoPct") ?? origen.anticipoPct,
    diasAnticipoAntes: n("diasAnticipoAntes") ?? origen.diasAnticipoAntes,
    diasSaldoDespues: n("diasSaldoDespues") ?? origen.diasSaldoDespues,
    costosUsdTm: n("costosUsdTm") ?? origen.costosUsdTm,
    capitalCop: capital,
  };

  const validado = esquemaEntradaCaso.safeParse(candidata);
  return validado.success ? { entrada: validado.data } : { errores: mensajesDeError(validado.error) };
}

const millones = (cop: number) => Math.round(cop / 1e6);

/**
 * Lo que el modelo ve de un resultado: lo justo para interpretarlo.
 *
 * Los pesos van en millones redondeados, que es como se van a citar; la
 * verificación acepta esa escala.
 */
export function resumirCaso(entrada: EntradaCaso, r: ResultadoCaso) {
  return {
    caso: {
      precioVentaUsdTm: entrada.precioVentaUsdTm,
      toneladas: r.toneladas,
      entregas: r.entregas.map((e) => ({
        entrega: e.fecha,
        toneladas: e.toneladas,
        compra: e.fechaCompra,
        anticipo: e.fechaAnticipo,
        saldo: e.fechaSaldo,
      })),
      descuentoCompraPct: entrada.descuentoCompraPct,
      anticipoPct: entrada.anticipoPct,
      costosUsdTm: entrada.costosUsdTm,
      capitalMillonesCop: millones(entrada.capitalCop),
    },
    alPrecioDeHoy: {
      margenUsdTm: Math.round(r.margenHoyUsdTm),
      utilidadMillonesCop: millones(r.utilidadHoyCop),
      nyDeEquilibrioUsdTm: r.equilibrioUsdTm != null ? Math.round(r.equilibrioUsdTm) : null,
    },
    estrategias: r.planes.map((p) => ({
      id: p.plan.id,
      nombre: p.plan.nombre,
      contratos: p.contratos,
      strikeUsdTm: p.strikeUsdTm,
      techoUsdTm: p.techoUsdTm,
      desembolsoHoyMillonesCop: millones(p.desembolsoHoyCop),
      primaUsd: Math.round(p.primaUsd),
      margenInicialUsd: Math.round(p.margenInicialUsd),
      utilidadMillonesCop: {
        media: millones(p.utilidad.mediaCop),
        peor5: millones(p.utilidad.p5Cop),
        mejor5: millones(p.utilidad.p95Cop),
      },
      probabilidadPerdidaPct: Math.round(p.utilidad.probabilidadPerdida * 1000) / 10,
      cajaMinimaMillonesCop: { mediana: millones(p.cajaMinima.mediana), peor5: millones(p.cajaMinima.p5) },
      probabilidadCajaNegativaPct: Math.round(p.probabilidadCajaNegativa * 1000) / 10,
      llamadasMargenPeor5MillonesCop: millones(p.llamadasMargenP95Cop),
      cabeEnCapital: p.cabeEnCapital,
      coberturaPorEntrega: p.porEntrega
        .filter((c) => c.contratos > 0)
        .map((c) => ({ contratos: c.contratos, vencimiento: c.vencimiento.simbolo, cierre: c.fechaCierre })),
    })),
    recomendada: r.recomendado,
    porQue: r.justificacion,
    advertencias: r.advertencias,
  };
}

function extraerTexto(contenido: Anthropic.ContentBlock[]): string {
  return contenido
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export interface OpcionesSimulador {
  cliente?: Anthropic;
  modelo?: string;
  maxSimulaciones?: number;
}

/**
 * Responde, simulando los casos que haga falta. El bucle es el del
 * analista de un análisis: acotado, porque cada vuelta es una llamada.
 */
export async function responderSimulador(
  contexto: ContextoSimulador,
  entradaActual: EntradaCaso | null,
  historial: readonly TurnoSimulador[],
  pregunta: string,
  hoy: string,
  opciones: OpcionesSimulador = {},
): Promise<RespuestaSimulador> {
  const desdeEntorno = opciones.cliente ? null : crearClienteAnthropic();
  const cliente = opciones.cliente ?? desdeEntorno!.cliente;
  const modelo = opciones.modelo ?? desdeEntorno?.modelo ?? "claude-opus-5";
  const maxSimulaciones = opciones.maxSimulaciones ?? 4;
  const porDefecto = entradaPorDefecto(contexto.descuentoMediano);

  const simular = (entrada: EntradaCaso) =>
    resumirCaso(entrada, simularCaso(casoDesdeEntrada(entrada, hoy), contexto.mercado, contexto.supuestos));

  const resumenes: unknown[] = [];
  let apertura = `Hoy es ${hoy}. Mercado: futuro NY ${Math.round(contexto.mercado.futuroUsdTm)} USD/TM, TRM ${Math.round(contexto.mercado.trm)} COP/USD. Descuento de compra habitual medido: ${porDefecto.descuentoCompraPct} %.\n\n`;
  const mercadoCitable = {
    futuroUsdTm: Math.round(contexto.mercado.futuroUsdTm),
    trm: Math.round(contexto.mercado.trm),
    descuentoCompraPct: porDefecto.descuentoCompraPct,
    porDefecto,
  };
  resumenes.push(mercadoCitable);

  if (entradaActual) {
    try {
      const actual = simular(entradaActual);
      resumenes.push(actual);
      apertura += `Este es el caso que tiene en pantalla:\n\n\`\`\`json\n${JSON.stringify(actual, null, 2)}\n\`\`\``;
    } catch {
      apertura += "El caso en pantalla está incompleto: no hay resultado todavía.";
    }
  } else {
    apertura += `Todavía no hay ningún caso en pantalla. Valores por defecto si el usuario no dice otra cosa: ${JSON.stringify(porDefecto)}.`;
  }

  const mensajes: Anthropic.MessageParam[] = [
    { role: "user", content: apertura },
    { role: "assistant", content: "Entendido. ¿Qué caso quiere revisar?" },
    ...historial.map(
      (t): Anthropic.MessageParam => ({ role: t.rol === "usuario" ? "user" : "assistant", content: t.texto }),
    ),
    { role: "user", content: pregunta },
  ];

  const casos: RespuestaSimulador["casos"] = [];
  let base = entradaActual;

  for (let vuelta = 0; vuelta <= maxSimulaciones; vuelta++) {
    let respuesta: Anthropic.Message;
    try {
      respuesta = await cliente.messages.create({
        model: modelo,
        max_tokens: 4000,
        system: PROMPT_SIMULADOR,
        thinking: { type: "adaptive" },
        tools: [HERRAMIENTA_SIMULAR],
        messages: mensajes,
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new ErrorAnalista("sin_credenciales", "La API key fue rechazada.");
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new ErrorAnalista("limite", "Se alcanzó el límite de peticiones.");
      }
      throw new ErrorAnalista("api", "No se pudo contactar con Anthropic.");
    }

    if (respuesta.stop_reason === "refusal") {
      throw new ErrorAnalista("rechazo", "El modelo declinó la petición.");
    }

    const usos = respuesta.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    if (usos.length === 0) {
      const texto = extraerTexto(respuesta.content);
      if (!texto) throw new ErrorAnalista("vacio", "La respuesta no contiene texto.");
      const verificacion = verificarCifras(texto, resumenes);
      return {
        texto,
        casos,
        sospechosas: verificacion.sospechosas.map((s) => ({ textual: s.textual, contexto: s.contexto })),
        modelo: respuesta.model,
      };
    }

    mensajes.push({ role: "assistant", content: respuesta.content });

    const resultados: Anthropic.ToolResultBlockParam[] = usos.map((uso) => {
      const pedido = (uso.input ?? {}) as Record<string, unknown>;
      const armado = entradaDesdeHerramienta(base, porDefecto, pedido);
      if ("errores" in armado) {
        return { type: "tool_result", tool_use_id: uso.id, is_error: true, content: armado.errores.join(" ") };
      }
      try {
        const resumen = simular(armado.entrada);
        resumenes.push(resumen);
        casos.push({ descripcion: String(pedido.descripcion ?? "caso"), entrada: armado.entrada });
        // Las siguientes variantes parten de la última: «¿y con 40 % de
        // anticipo?» se entiende sobre el caso que acaba de armar.
        base = armado.entrada;
        return { type: "tool_result", tool_use_id: uso.id, content: JSON.stringify(resumen) };
      } catch (error) {
        return {
          type: "tool_result",
          tool_use_id: uso.id,
          is_error: true,
          content: error instanceof Error ? error.message : "No se pudo calcular ese caso.",
        };
      }
    });

    mensajes.push({ role: "user", content: resultados });
  }

  throw new ErrorAnalista("api", `El analista pidió más de ${maxSimulaciones} simulaciones sin llegar a una respuesta.`);
}
