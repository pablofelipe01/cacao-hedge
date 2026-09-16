/**
 * El analista: conversación sobre un análisis ya hecho.
 *
 * El informe narra un resultado fijo. Esto responde preguntas que ese
 * resultado no contempla: «¿y si solo consigo 30 de las 40 toneladas?»,
 * «¿y si el cacao sube a 7.000 antes de que compre?», «¿y si me cubro con
 * collar en vez de futuros?».
 *
 * La regla que gobierna toda la aplicación no cambia aquí, y es lo que
 * hace este módulo distinto de un chat cualquiera: EL MODELO NO CALCULA.
 * Cuando una pregunta exige cifras que no están en la mesa, no las
 * estima: llama a una herramienta que vuelve a correr el motor con las
 * entradas cambiadas y le devuelve números de verdad.
 *
 * Eso es posible porque el motor es puro, determinista y rápido —unos
 * cincuenta milisegundos por análisis completo, con sus diez mil
 * trayectorias—. Un chat que estime cifras de cobertura es peor que no
 * tener chat: suena igual de seguro y no lo está.
 */

import Anthropic from "@anthropic-ai/sdk";

import { crearClienteAnthropic } from "./cliente";
import { construirResumen, type ResumenCuantitativo } from "./resumen";
import { verificarCifras } from "./verificacion";
import { analizarCobertura } from "@/lib/engine/index";
import type { Lote, Mercado, Supuestos } from "@/lib/engine/tipos";

/** Un turno de la conversación, tal como se guarda y se muestra. */
export interface TurnoChat {
  rol: "usuario" | "analista";
  texto: string;
  /** Escenarios que el analista recalculó para responder. */
  recalculos?: { descripcion: string; cambios: Record<string, number> }[];
}

export interface RespuestaAnalista {
  texto: string;
  recalculos: { descripcion: string; cambios: Record<string, number> }[];
  /** Cifras del texto que no rastrean a ningún dato calculado. */
  sospechosas: { textual: string; contexto: string }[];
  modelo: string;
}

export class ErrorAnalista extends Error {
  readonly causa: "sin_credenciales" | "limite" | "rechazo" | "api" | "vacio";

  constructor(causa: ErrorAnalista["causa"], mensaje: string) {
    super(mensaje);
    this.name = "ErrorAnalista";
    this.causa = causa;
  }

  get mensajeUsuario(): string {
    switch (this.causa) {
      case "sin_credenciales":
        return "Falta configurar ANTHROPIC_API_KEY en el servidor.";
      case "limite":
        return "El servicio está saturado. Intente de nuevo en unos minutos.";
      case "rechazo":
        return "El modelo declinó responder esta pregunta.";
      case "vacio":
        return "El modelo no devolvió texto. Intente de nuevo.";
      case "api":
        return "No se pudo contactar con el analista. El análisis no se ve afectado.";
    }
  }
}

export const PROMPT_ANALISTA = `Eres el analista de riesgos que acompaña a un exportador colombiano de cacao mientras mira un análisis de cobertura en pantalla. Conversas con él: respondes preguntas, exploras alternativas y señalas lo que no está mirando.

## La regla que no se rompe nunca

NO CALCULAS. Ni sumas, ni restas, ni porcentajes, ni proyecciones, ni «aproximadamente».

Tienes dos fuentes de cifras y solo dos:
1. El JSON del análisis que está en pantalla.
2. Lo que devuelva la herramienta \`recalcular\`.

Si una pregunta necesita un número que no está en ninguna de las dos, **llama a \`recalcular\`**. Para eso existe: vuelve a correr el motor de cálculo con las entradas que le cambies y te devuelve resultados reales.

Ejemplos de cuándo llamarla:
- «¿y si solo consigo 30 toneladas?» → recalcular con toneladas: 30
- «¿y si el cacao sube a 7.000?» → recalcular con futuroUsdTm: 7000
- «¿y si el dólar se va a 3.500?» → recalcular con trm: 3500
- «¿y si me demoro dos meses más?» → recalcular con diasAEmbarque
- «¿y si el productor me sube el precio?» → recalcular con diferencialPorcentaje

Si el usuario pregunta por una estrategia que ya está en la tabla (un collar, un call, otro ratio de futuros), NO hace falta recalcular: las cifras de todas las estrategias ya están en el JSON.

Nunca digas «aproximadamente X» ni «alrededor de Y» con una cifra inventada. Si no la tienes y no puedes obtenerla, dilo en palabras: «bastante menos», «cerca de la mitad».

Un número inventado aquí termina en una orden a una mesa de operaciones.

## Cómo conversas

- Español de Colombia, directo, sin jerga innecesaria. Si usas un término técnico, explícalo en la misma frase.
- Respuestas cortas. Esto es una conversación, no un informe: dos o tres párrafos bastan casi siempre.
- Responde lo que le preguntaron, primero. Si hay algo importante que no preguntó, dilo después y en una frase.
- Unidades siempre así: **USD/TM**, **COP/kg**, **COP/USD**.
- Cuando compares escenarios, di explícitamente cuál es cuál. «Con 40 toneladas… con 30 toneladas…».
- Si la pregunta es ambigua en algo que cambia la respuesta, pregunta antes de calcular.

## Qué aportas que la pantalla no

- Interpretación: qué significa una cifra para SU negocio.
- Lo que se sacrifica en cada alternativa. Toda cobertura renuncia a algo.
- Riesgos que ningún número captura: clima en África Occidental, calidad y certificaciones que mueven su diferencial, contenedores y puertos, la contraparte, y la caja que exigen las llamadas de margen.
- Y lo que la herramienta NO hace: no pronostica precios, no fija su diferencial, no parte contratos, y no es asesoría financiera. Si la pregunta pide un pronóstico, dígalo: nadie sabe dónde estará el cacao, y por eso se cubre.

## Límites

- Esto es apoyo a la decisión, no asesoría financiera. Describe qué hace cada alternativa y qué protege; no digas «debería» ni «le recomiendo invertir».
- No inventes contexto de mercado que no esté en los datos: existencias mundiales, posiciones de fondos, cifras de molienda.
- Si el usuario propone algo que le duplicaría la exposición en vez de cubrirla, dilo con claridad.`;

/** La herramienta que le devuelve al modelo cifras de verdad. */
export const HERRAMIENTA_RECALCULAR: Anthropic.Tool = {
  name: "recalcular",
  description:
    "Vuelve a correr el motor de cobertura cambiando solo lo que se le indique; todo lo demás se mantiene igual al análisis en pantalla. Devuelve el mismo resumen cuantitativo, con todas las estrategias, el percentil 5, la probabilidad de pérdida y el dimensionamiento. Úsala siempre que necesites una cifra que no esté en el análisis actual: no estimes.",
  input_schema: {
    type: "object",
    properties: {
      descripcion: {
        type: "string",
        description:
          "Qué escenario representa, en una frase y en español. Ej.: «solo consigue 30 de las 40 toneladas».",
      },
      toneladas: { type: "number", description: "Toneladas de la operación." },
      diasAEmbarque: { type: "number", description: "Días hasta el embarque o la compra." },
      precioVentaUsdTm: {
        type: "number",
        description: "Precio de venta pactado, USD/TM. Solo si la venta está cerrada.",
      },
      diferencialUsdTm: {
        type: "number",
        description: "Diferencial fijo en USD/TM. Negativo si compra por debajo de la bolsa.",
      },
      diferencialPorcentaje: {
        type: "number",
        description:
          "Diferencial como porcentaje del futuro. −23,5 significa comprar un 23,5 % por debajo de Nueva York. Manda sobre diferencialUsdTm.",
      },
      futuroUsdTm: { type: "number", description: "Precio del futuro CC, USD/TM." },
      trm: { type: "number", description: "Tasa de cambio, COP/USD." },
      costoCopKg: {
        type: "number",
        description: "Costo de adquisición ya pagado, COP/kg. Solo con inventario.",
      },
    },
    required: ["descripcion"],
  },
};

/** Entradas del análisis que está en pantalla, para partir de ahí. */
export interface ContextoAnalisis {
  lote: Lote;
  mercado: Mercado;
  supuestos: Supuestos;
  fechaEmbarque: string;
  procedencia: { fuente: string; simbolo: string; barras: number };
}

/**
 * Corre el motor con las entradas cambiadas.
 *
 * Parte SIEMPRE del análisis en pantalla y solo pisa lo que venga: así,
 * una respuesta sobre «30 toneladas en vez de 40» conserva el mismo
 * precio, el mismo diferencial y los mismos supuestos, y la comparación
 * es honesta.
 */
export function ejecutarRecalculo(
  contexto: ContextoAnalisis,
  entrada: Record<string, unknown>,
): ResumenCuantitativo {
  const n = (clave: string): number | undefined => {
    const v = entrada[clave];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  const pct = n("diferencialPorcentaje");

  const lote: Lote = {
    ...contexto.lote,
    toneladas: n("toneladas") ?? contexto.lote.toneladas,
    diasAEmbarque: n("diasAEmbarque") ?? contexto.lote.diasAEmbarque,
    costoCopKg: n("costoCopKg") ?? contexto.lote.costoCopKg,
    precioVentaUsdTm: n("precioVentaUsdTm") ?? contexto.lote.precioVentaUsdTm,
    ...(pct != null
      ? { diferencialPorcentual: pct / 100, diferencialUsdTm: 0 }
      : n("diferencialUsdTm") != null
        ? { diferencialUsdTm: n("diferencialUsdTm")!, diferencialPorcentual: null }
        : {}),
  };

  const mercado: Mercado = {
    ...contexto.mercado,
    futuroUsdTm: n("futuroUsdTm") ?? contexto.mercado.futuroUsdTm,
    trm: n("trm") ?? contexto.mercado.trm,
  };

  const r = analizarCobertura(lote, mercado, contexto.supuestos);

  return construirResumen({
    lote,
    fechaEmbarque: contexto.fechaEmbarque,
    mercado,
    supuestos: contexto.supuestos,
    evaluaciones: r.evaluaciones,
    recomendacion: r.recomendacion,
    precioEquilibrioUsdTm: r.precioEquilibrioUsdTm,
    dimensionamiento: r.dimensionamiento,
    procedencia: contexto.procedencia,
    advertencias: r.advertencias,
  });
}

/** Concatena los bloques de texto de una respuesta. */
function extraerTexto(contenido: Anthropic.ContentBlock[]): string {
  return contenido
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export interface OpcionesAnalista {
  cliente?: Anthropic;
  modelo?: string;
  /** Tope de recálculos por respuesta, para que no se vaya en bucle. */
  maxRecalculos?: number;
}

/**
 * Responde una pregunta sobre el análisis, recalculando si hace falta.
 *
 * El bucle es manual y acotado: el modelo pide un recálculo, se ejecuta,
 * se le devuelve el resultado, y así hasta que responda con texto o hasta
 * el tope. Acotarlo importa porque cada vuelta es una llamada a la API y
 * un usuario esperando.
 */
export async function responderAnalista(
  contexto: ContextoAnalisis,
  resumenActual: ResumenCuantitativo,
  historial: readonly TurnoChat[],
  pregunta: string,
  opciones: OpcionesAnalista = {},
): Promise<RespuestaAnalista> {
  const desdeEntorno = opciones.cliente ? null : crearClienteAnthropic();
  const cliente = opciones.cliente ?? desdeEntorno!.cliente;
  const modelo = opciones.modelo ?? desdeEntorno?.modelo ?? "claude-opus-5";
  const maxRecalculos = opciones.maxRecalculos ?? 4;

  const mensajes: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Este es el análisis que el exportador tiene en pantalla:\n\n\`\`\`json\n${JSON.stringify(resumenActual, null, 2)}\n\`\`\``,
    },
    {
      role: "assistant",
      content: "Listo, lo tengo delante. ¿Qué quiere revisar?",
    },
    ...historial.map(
      (t): Anthropic.MessageParam => ({
        role: t.rol === "usuario" ? "user" : "assistant",
        content: t.texto,
      }),
    ),
    { role: "user", content: pregunta },
  ];

  const recalculos: RespuestaAnalista["recalculos"] = [];
  const resumenesUsados: unknown[] = [resumenActual];

  for (let vuelta = 0; vuelta <= maxRecalculos; vuelta++) {
    let respuesta: Anthropic.Message;
    try {
      respuesta = await cliente.messages.create({
        model: modelo,
        max_tokens: 4000,
        system: PROMPT_ANALISTA,
        thinking: { type: "adaptive" },
        tools: [HERRAMIENTA_RECALCULAR],
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

    const usos = respuesta.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (usos.length === 0) {
      const texto = extraerTexto(respuesta.content);
      if (!texto) throw new ErrorAnalista("vacio", "La respuesta no contiene texto.");

      // La misma verificación que el informe: cada cifra del texto debe
      // rastrear a algún resumen que el motor produjo, sea el de pantalla
      // o el de un recálculo.
      const verificacion = verificarCifras(texto, resumenesUsados);

      return {
        texto,
        recalculos,
        sospechosas: verificacion.sospechosas.map((s) => ({
          textual: s.textual,
          contexto: s.contexto,
        })),
        modelo: respuesta.model,
      };
    }

    mensajes.push({ role: "assistant", content: respuesta.content });

    const resultados: Anthropic.ToolResultBlockParam[] = usos.map((uso) => {
      const entrada = (uso.input ?? {}) as Record<string, unknown>;
      try {
        const resumen = ejecutarRecalculo(contexto, entrada);
        resumenesUsados.push(resumen);

        recalculos.push({
          descripcion: String(entrada.descripcion ?? "escenario alternativo"),
          // Solo los cambios numéricos: la descripción ya va aparte, y
          // esto se muestra al usuario como «qué se movió».
          cambios: Object.fromEntries(
            Object.entries(entrada).filter(([, v]) => typeof v === "number"),
          ) as Record<string, number>,
        });

        return {
          type: "tool_result",
          tool_use_id: uso.id,
          content: JSON.stringify(resumen),
        };
      } catch (error) {
        // Un escenario imposible —cero toneladas, una fecha pasada— no es
        // un fallo del chat: es información. El modelo puede explicar por
        // qué no se puede calcular eso.
        return {
          type: "tool_result",
          tool_use_id: uso.id,
          is_error: true,
          content: error instanceof Error ? error.message : "No se pudo calcular ese escenario.",
        };
      }
    });

    mensajes.push({ role: "user", content: resultados });
  }

  throw new ErrorAnalista(
    "api",
    `El analista pidió más de ${maxRecalculos} recálculos sin llegar a una respuesta.`,
  );
}
