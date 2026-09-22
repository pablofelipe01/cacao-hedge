import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";

/**
 * Guía de lectura de la herramienta.
 *
 * Va dentro de la aplicación y no en un documento aparte porque es donde
 * el usuario la necesita —a un clic del formulario— y porque así se
 * versiona con el código: si cambia una estrategia o una cifra de
 * ejemplo, cambia aquí en el mismo commit.
 *
 * Contenido estático: sin consultas, sin estado, sin JavaScript de
 * cliente.
 */
export const metadata = {
  title: "Guía rápida · CacaoHedge",
  description:
    "Qué pregunta responde CacaoHedge, cuál de los dos casos de cobertura es el suyo y qué no hace la herramienta.",
};

/**
 * Los dos casos, en espejo: cada fila se invierte punto por punto.
 *
 * Sin letras a propósito. La guía llamaba «caso A» a «ya vendí» y el
 * exportador llama caso A a «tengo el cacao»: una etiqueta que cada uno lee
 * al revés es peor que ninguna. Se nombran por la situación, y va primero
 * la que él vive más a menudo.
 */
const CASOS = [
  {
    titulo: "Tiene el cacao comprado",
    situacion:
      "El cacao ya está en bodega y pagado. Todavía no tiene comprador, o lo vendió contra Nueva York y el precio se fija al embarcar.",
    flecha: "↓",
    riesgo: "baje",
    riesgoDetalle: "tendría que venderlo por menos de lo que le costó",
    accion: "Vender",
    cobertura:
      "Si el mercado cae, lo que pierde en el físico lo gana en la bolsa.",
    opciones: "Puts y collar",
  },
  {
    titulo: "Ya vendió a precio fijo, y le falta comprar el cacao",
    situacion:
      "Cerró una venta al exterior a precio firme y todavía debe abastecerse para completar la orden.",
    flecha: "↑",
    riesgo: "suba",
    riesgoDetalle: "tendría que comprarlo más caro de lo que ya lo vendió",
    accion: "Comprar",
    cobertura:
      "Si el mercado sube, lo que paga de más por el físico lo gana en la bolsa.",
    opciones: "Calls y collar inverso",
  },
];

/**
 * Corrida real de prueba, no datos de ningún cliente.
 *
 * Se deja fija a propósito: un ejemplo que cambia con el mercado deja de
 * servir para explicar, porque las cifras del texto y las de la tabla se
 * separan.
 */
const EJEMPLO = [
  { nombre: "Sin cobertura", contratos: "—", perdida: "33,1 %", peor: "−240,6 M", costo: "—", tono: "malo" },
  { nombre: "Compra de futuros 50–75 %", contratos: "2", perdida: "18,4 %", peor: "−56,8 M", costo: "—", tono: "" },
  { nombre: "Compra de futuros 100 %", contratos: "3", perdida: "2,3 %", peor: "+10,1 M", costo: "—", tono: "bueno", destacada: true },
  { nombre: "Collar inverso 6.250 / 5.725", contratos: "3", perdida: "8,4 %", peor: "−8,6 M", costo: "127 USD", tono: "" },
  { nombre: "Call protector 5.950", contratos: "3", perdida: "33,7 %", peor: "−40,1 M", costo: "18.812 USD", tono: "malo" },
];

const CIFRAS = [
  {
    termino: "Punto de equilibrio",
    definicion:
      "Con inventario, el precio mínimo de venta que cubre lo que ya pagó por el cacao. Con una venta cerrada cambia de nombre a «precio máximo de compra»: el techo que todavía deja margen.",
  },
  {
    termino: "Exposición nominal",
    definicion:
      "Cuánta plata está sujeta al vaivén del precio. No es una pérdida: es el tamaño de lo que está en juego.",
  },
  {
    termino: "Probabilidad de pérdida",
    definicion:
      "De diez mil caminos simulados del precio y la TRM, en qué porcentaje la operación termina en rojo.",
  },
  {
    termino: "Utilidad en el peor 5 %",
    definicion:
      "Descarte los 9.500 mejores caminos y mire los 500 peores. Esta es la cifra que decide, porque es la que lo quiebra.",
  },
  {
    termino: "Llamadas de margen",
    definicion:
      "Cubrirse con futuros exige caja. Verá cuánto capital queda inmovilizado y a qué precio le pedirían más, aunque la posición sea correcta.",
  },
  {
    termino: "Diferencial (o base)",
    definicion:
      "La distancia entre el precio de Nueva York y lo que usted paga o cobra de verdad. Futuro + diferencial = precio del físico, así que va con signo menos cuando compra por debajo de la bolsa, que al comprar en Colombia es lo habitual. La cobertura NO fija este número, y es suyo: calidad, certificaciones, logística y demanda de origen lo mueven aparte.",
  },
];

/**
 * Las cuatro cifras que resumen el tamaño del cálculo.
 *
 * Van aquí y no leídas del motor porque son el contrato de la guía: si
 * alguna cambia en `SUPUESTOS_POR_DEFECTO` o en `escenarios.ts`, esta
 * página tiene que cambiar en el mismo commit, y una constante duplicada
 * a la vista se corrige; una leída en silencio se desactualiza sola.
 */
const METODO = [
  { cifra: "10.000", unidad: "trayectorias", pie: "simulación Monte Carlo, ajustable en Supuestos" },
  { cifra: "63", unidad: "escenarios", pie: "matriz determinística: 7 precios × 3 TRM × 3 bases" },
  { cifra: "95 %", unidad: "confianza", pie: "VaR y pérdida esperada en la cola" },
  { cifra: "252", unidad: "días hábiles", pie: "base de anualización de la volatilidad" },
];

const LIMITES = [
  {
    titulo: "No pronostica el precio",
    texto:
      "En la simulación, el valor esperado del futuro dentro de 90 días es el precio de hoy. Es deliberado: un futuro no tiene tendencia predecible, y meterle una sería incorporar una opinión, no un hecho. La herramienta mide su exposición; no adivina el mercado.",
  },
  {
    titulo: "No fija su diferencial",
    texto:
      "Cubrirse con futuros fija el componente de Nueva York, no la distancia entre la bolsa y su precio real. Si el futuro no se mueve pero esa distancia se abre 150 USD/TM, esos 150 los pone usted y la cobertura no le devuelve nada. Ese riesgo de base sigue vivo y se modela aparte, precisamente para no esconderlo.",
  },
  {
    titulo: "No parte contratos",
    texto:
      "Un contrato CC son 10 toneladas exactas e indivisibles. Con 15,275 TM en bodega salen 1,53 contratos: o cubre 10 y deja 5,28 TM expuestas, o cubre 20 y queda vendido sobre 4,73 TM que no tiene. Verá las dos alternativas porque esa decisión es suya, no del cálculo.",
  },
  {
    titulo: "No es asesoría financiera",
    texto:
      "Es apoyo a la decisión. Todas las cifras las calcula el motor, que está probado; el informe escrito lo redacta un modelo de lenguaje que no hace ningún cálculo propio y que se verifica después, cifra por cifra, contra los resultados del motor.",
  },
];

const PASOS = [
  "Escoja la situación real de una operación que tenga hoy sobre la mesa. Si tiene las dos, córralas por separado.",
  "Ponga cifras suyas de verdad, no redondas. El inventario se llena solo desde la hoja de operaciones; el resto —fecha, diferencial, precio pactado— lo pone usted.",
  "Mire primero la tabla de comparación, no la recomendación. Fíjese en qué le cuesta cada protección y qué le quita de la cola mala.",
  "Genere el informe escrito. Tarda cerca de un minuto y explica en palabras qué se sacrifica al seguir la recomendación.",
];

export default function PaginaGuia() {
  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Guía rápida</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          Diez minutos antes de su primera sesión: qué pregunta responde esta
          herramienta, cuál de los dos casos es el suyo y —sobre todo— qué no hace.
        </p>
      </header>

      {/* --- La pregunta ------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          La pregunta no es «¿cuánto va a valer el cacao?»
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          Esa pregunta no tiene respuesta honesta, y cualquier herramienta que se la dé
          le está vendiendo una opinión disfrazada de cálculo.
        </p>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          CacaoHedge responde otra, que es la que de verdad decide:{" "}
          <strong className="font-semibold text-texto">
            ¿cuánto me duele si me equivoco?
          </strong>{" "}
          Con su tonelaje, su costo y su fecha de embarque simula diez mil caminos
          posibles del precio y le dice con qué probabilidad esa operación termina
          perdiendo plata, cuánto pierde en el peor de los casos, y cuánto de ese riesgo
          puede quitarse —y a qué costo.
        </p>
      </section>

      {/* --- Los dos casos ------------------------------------------------ */}
      <section aria-labelledby="casos" className="space-y-3">
        <h2 id="casos" className="text-sm font-semibold">
          Su negocio tiene dos casos, y son opuestos
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          Lo primero que pregunta el formulario es en cuál de las dos situaciones está.
          No es un trámite: de esa respuesta depende si la cobertura consiste en{" "}
          <strong className="font-semibold text-texto">vender</strong> o en{" "}
          <strong className="font-semibold text-texto">comprar</strong> futuros.
          Equivocarse ahí no da un resultado incompleto, da el consejo exactamente al
          revés.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {CASOS.map((caso) => (
            <article
              key={caso.titulo}
              className="space-y-3 rounded-lg border border-borde bg-superficie p-4"
            >
              <h3 className="text-sm font-medium leading-snug">{caso.titulo}</h3>

              <dl className="space-y-2.5 text-xs leading-relaxed">
                <div>
                  <dt className="text-texto-suave">La situación</dt>
                  <dd className="mt-0.5">{caso.situacion}</dd>
                </div>
                <div>
                  <dt className="text-texto-suave">El riesgo</dt>
                  <dd className="mt-0.5">
                    <span aria-hidden className="pr-1 font-medium text-ambar">
                      {caso.flecha}
                    </span>
                    Que el precio{" "}
                    <strong className="font-semibold">{caso.riesgo}</strong>:{" "}
                    {caso.riesgoDetalle}.
                  </dd>
                </div>
                <div>
                  <dt className="text-texto-suave">La cobertura</dt>
                  <dd className="mt-0.5">
                    <strong className="font-semibold">{caso.accion}</strong> futuros.{" "}
                    {caso.cobertura}
                  </dd>
                </div>
                <div>
                  <dt className="text-texto-suave">Opciones que protegen</dt>
                  <dd className="mt-0.5">{caso.opciones}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      {/* --- Ejemplo ------------------------------------------------------ */}
      <section aria-labelledby="ejemplo" className="space-y-3">
        <h2 id="ejemplo" className="text-sm font-semibold">
          Un ejemplo con cifras: vendió a precio fijo y le falta comprar
        </h2>

        <div className="space-y-3 rounded-lg border border-borde bg-superficie p-4">
          <p className="text-xs uppercase tracking-wide text-texto-suave">
            Ejemplo de prueba · no son datos de su operación
          </p>
          <p className="max-w-prose text-sm leading-relaxed">
            Venta cerrada de 40 TM a 5.000 USD/TM, entrega a 90 días. Al productor le
            compra un 23 % por debajo de la bolsa. El futuro CC de Nueva York está en
            5.961, así que abastecerse cuesta hoy unos{" "}
            <span className="tabular font-medium">4.590 USD/TM</span>. El techo —hasta
            dónde puede subir Nueva York antes de que la venta deje de dejarle plata— es{" "}
            <span className="tabular font-medium">6.494</span>: 533 dólares de colchón,
            con el cacao moviéndose a una volatilidad del 53 % anual.
          </p>
          <p className="max-w-prose text-sm leading-relaxed">
            Fíjese en los contratos: son 3, no 4. Como compra a un porcentaje de la
            bolsa, su costo solo se mueve el 77 % de lo que se mueve Nueva York, y el
            riesgo real es de 30,8 toneladas, no de 40.
          </p>

          <div className="overflow-x-auto">
            <table className="tabular w-full text-sm">
              <thead>
                <tr className="border-b border-borde text-left text-xs text-texto-suave">
                  <th scope="col" className="py-2 pr-3 font-medium">Estrategia</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Contratos</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">P(pérdida)</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Peor 5 %</th>
                  <th scope="col" className="py-2 text-right font-medium">Costo inicial</th>
                </tr>
              </thead>
              <tbody>
                {EJEMPLO.map((fila) => (
                  <tr
                    key={fila.nombre}
                    className={`border-b border-borde last:border-0 ${
                      fila.destacada ? "font-medium" : ""
                    }`}
                  >
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {fila.destacada ? (
                        <span className="border-l-2 border-ambar pl-2">{fila.nombre}</span>
                      ) : (
                        fila.nombre
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">{fila.contratos}</td>
                    <td
                      className={`py-2 pr-3 text-right ${
                        fila.tono === "malo"
                          ? "text-negativo"
                          : fila.tono === "bueno"
                            ? "text-positivo"
                            : ""
                      }`}
                    >
                      {fila.perdida}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right ${
                        fila.peor.startsWith("+") ? "text-positivo" : "text-negativo"
                      }`}
                    >
                      {fila.peor}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">{fila.costo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="max-w-prose text-xs leading-relaxed text-texto-suave">
            Cifras en pesos. La recomendación sale del{" "}
            <strong className="font-semibold text-texto">peor 5 %</strong>, no de la
            utilidad promedio: proteger la cola es el punto de cubrirse. Comprar futuros
            baja la probabilidad de pérdida del 33,1 % al 2,3 %. No llega a cero porque
            el descuento al productor también se mueve, y eso la bolsa no lo cubre. Los{" "}
            <em>calls</em> salen mal parados: la prima se come buena parte del margen.
          </p>
        </div>
      </section>

      {/* --- Las cifras --------------------------------------------------- */}
      <section aria-labelledby="cifras" className="space-y-3">
        <h2 id="cifras" className="text-sm font-semibold">
          Qué significa cada cifra
        </h2>
        <dl className="divide-y divide-borde border-y border-borde">
          {CIFRAS.map((cifra) => (
            <div key={cifra.termino} className="grid gap-1 py-3 sm:grid-cols-[13rem_1fr] sm:gap-6">
              <dt className="text-sm font-medium">{cifra.termino}</dt>
              <dd className="max-w-prose text-sm leading-relaxed text-texto-suave">
                {cifra.definicion}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* --- Cómo se calcula ----------------------------------------------- */}
      <section aria-labelledby="metodo" className="space-y-3">
        <h2 id="metodo" className="text-sm font-semibold">
          Cómo se calcula
        </h2>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          Detrás de cada pantalla hay un motor de cálculo, no una hoja de cálculo.
          Vale la pena saber qué hace, porque explica por qué puede confiar en las
          cifras —y hasta dónde.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {METODO.map((m) => (
            <div key={m.unidad} className="rounded-lg border border-borde bg-superficie p-3">
              <p className="tabular text-lg font-semibold leading-tight">{m.cifra}</p>
              <p className="text-xs font-medium">{m.unidad}</p>
              <p className="mt-1 text-xs leading-relaxed text-texto-suave">{m.pie}</p>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="border-l-2 border-cacao-claro pl-4">
            <h3 className="text-sm font-medium">Diez mil futuros posibles, no uno</h3>
            <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-texto-suave">
              La simulación de Monte Carlo genera diez mil caminos del precio del
              cacao y de la TRM hasta su fecha de embarque, y evalúa su operación
              en cada uno. De ahí salen la probabilidad de pérdida y el peor 5 %:
              no son estimaciones a ojo, son el recuento de diez mil resultados.
              Cada camino se simula junto con su reflejo —si uno sube, el otro baja
              lo mismo—, para que el azar del simulador no se confunda con un
              efecto económico real.
            </p>
          </div>

          <div className="border-l-2 border-cacao-claro pl-4">
            <h3 className="text-sm font-medium">Y 63 escenarios escogidos a mano</h3>
            <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-texto-suave">
              Además de la simulación, la matriz cruza siete movimientos de precio
              (de −30 % a +30 %) con tres de la TRM y tres del diferencial. Responde
              una pregunta distinta: no «con qué probabilidad», sino «si pasa
              exactamente esto, cuánto gano o pierdo». Es la tabla de colores que
              verá en los resultados.
            </p>
          </div>

          <div className="border-l-2 border-cacao-claro pl-4">
            <h3 className="text-sm font-medium">Con sus datos, no con supuestos</h3>
            <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-texto-suave">
              La volatilidad no es un número inventado: sale del histórico real del
              contrato CC de Nueva York que usted escoja. La tasa de cambio es la{" "}
              <strong className="font-semibold text-texto">TRM oficial</strong> del
              portal de datos abiertos del Estado colombiano. Las opciones se valoran
              con Black-76, que es el modelo estándar para opciones sobre futuros.
            </p>
          </div>

          <div className="border-l-2 border-cacao-claro pl-4">
            <h3 className="text-sm font-medium">Las mismas cifras dentro de seis meses</h3>
            <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-texto-suave">
              El azar de la simulación parte de una semilla fija y cada análisis
              guarda la fotografía completa de sus datos de entrada y del mercado de
              ese día. Si abre este análisis el año entrante, las cifras serán
              idénticas —aunque el precio de hoy ya no tenga nada que ver—. Sirve
              para auditar una decisión, no solo para tomarla.
            </p>
          </div>

          <div className="border-l-2 border-ambar pl-4">
            <h3 className="text-sm font-medium">La inteligencia artificial no calcula nada</h3>
            <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-texto-suave">
              Conviene ser explícito: el informe escrito lo redacta un modelo de
              lenguaje, pero <strong className="font-semibold text-texto">no hace
              una sola operación aritmética</strong>. Recibe las cifras ya calculadas
              por el motor y solo las interpreta. Después, el sistema revisa el texto
              y busca cada número que aparece en él dentro de los datos de entrada: lo
              que no rastree a un dato real queda marcado a la vista. Una instrucción
              es una petición, no una garantía.
            </p>
          </div>
        </div>
      </section>

      {/* --- Límites ------------------------------------------------------ */}
      <section aria-labelledby="limites" className="space-y-3">
        <h2 id="limites" className="text-sm font-semibold">
          Lo que esta herramienta no hace
        </h2>
        <div className="space-y-4">
          {LIMITES.map((limite) => (
            <div key={limite.titulo} className="border-l-2 border-cacao-claro pl-4">
              <h3 className="text-sm font-medium">{limite.titulo}</h3>
              <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-texto-suave">
                {limite.texto}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* --- Primera sesión ------------------------------------------------ */}
      <section aria-labelledby="pasos" className="space-y-3">
        <h2 id="pasos" className="text-sm font-semibold">
          Qué hacer en su primera sesión
        </h2>
        <ol className="space-y-3">
          {PASOS.map((paso, i) => (
            <li key={paso} className="grid grid-cols-[1.5rem_1fr] gap-3 text-sm leading-relaxed">
              <span className="tabular border-b border-borde pb-0.5 text-xs text-ambar">
                {i + 1}
              </span>
              <span className="max-w-prose text-texto-suave">{paso}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/analisis/nuevo"
            className="rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro"
          >
            Empezar un análisis
          </Link>
          <Link
            href="/guia/resultados"
            className="rounded-md border border-cacao px-3 py-2 text-sm font-medium text-cacao transition hover:bg-cacao hover:text-white"
          >
            Qué significa cada cifra
          </Link>
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
