import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";

/**
 * Coquito: qué quiere decir cada cifra de la pantalla de resultados.
 *
 * La guía general explica el negocio; esta explica la PANTALLA, casilla
 * por casilla, en el orden en que aparecen. Nació de una sesión real
 * mirando un análisis con el cliente: las preguntas no eran «¿qué es una
 * cobertura?» sino «¿qué me está diciendo este número?».
 *
 * Contenido estático: sin consultas, sin estado, sin JavaScript de
 * cliente.
 */
export const metadata = {
  title: "Qué significa cada cifra · CacaoHedge",
  description:
    "Recorrido casilla por casilla de la pantalla de resultados: qué es cada número, qué quiere decir y qué hay que tener en cuenta.",
};

/** Una cifra de la pantalla, con su lectura y su letra pequeña. */
interface Cifra {
  titulo: string;
  ejemplo?: string;
  que: string;
  ojo?: string;
}

interface Bloque {
  seccion: string;
  intro?: string;
  cifras: Cifra[];
}

const BLOQUES: Bloque[] = [
  {
    seccion: "La cabecera",
    intro:
      "La línea de arriba resume qué operación está mirando. Si algo ahí no coincide con su realidad, todo lo demás sobra.",
    cifras: [
      {
        titulo: "«10 TM por comprar» o «15,275 TM en bodega»",
        que: "Cuántas toneladas están en juego, y si ya son suyas o le faltan. De eso depende si la cobertura se vende o se compra.",
      },
      {
        titulo: "«diferencial −23,5 % de NY»",
        que: "La distancia entre Nueva York y lo que usted paga o cobra de verdad. Negativo significa por debajo de la bolsa, que al comprar en Colombia es lo normal.",
        ojo: "Este número es el que más mueve el análisis. Si lo puso de memoria, vaya a Precios y use el medido.",
      },
    ],
  },
  {
    seccion: "Las cuatro tarjetas",
    cifras: [
      {
        titulo: "Futuro CC de referencia",
        ejemplo: "5.961 USD/TM · vol. 53,4 %",
        que: "A cuánto está el cacao en la bolsa de Nueva York. La «vol» dice cuánto se mueve ese precio: 53 % significa que en un año puede variar la mitad de su valor.",
        ojo: "Esa volatilidad es alta. Es la razón de que este ejercicio tenga sentido.",
      },
      {
        titulo: "TRM",
        ejemplo: "3.109,30 COP/USD",
        que: "Cuántos pesos vale un dólar hoy, según la tasa oficial.",
      },
      {
        titulo: "Exposición nominal / Costo esperado de la compra",
        ejemplo: "141,8 M COP",
        que: "Cuánta plata está sujeta al vaivén del precio. Con inventario es lo que espera cobrar; con una venta cerrada, lo que espera pagar.",
        ojo: "No es una pérdida ni una ganancia: es el tamaño de lo que está en juego.",
      },
      {
        titulo: "Punto de equilibrio / Precio máximo de compra",
        ejemplo: "8.497 USD/TM",
        que: "Su frontera. Con inventario, el precio mínimo al que puede vender sin perder. Con una venta cerrada, el precio máximo al que puede comprar.",
        ojo: "Compárelo con el futuro de hoy. La distancia entre los dos es su colchón, y es lo primero que hay que mirar.",
      },
    ],
  },
  {
    seccion: "Qué cambia cubrirse",
    intro: "Las tres cifras que comparan cubrirse contra no hacer nada.",
    cifras: [
      {
        titulo: "Probabilidad de pérdida",
        ejemplo: "0,0 % · sin cobertura: 0,1 %",
        que: "De cada 100 caminos simulados, en cuántos la operación termina en rojo.",
        ojo: "Si sin cubrirse ya es muy baja, cubrirse no le está salvando el negocio: le está asegurando una ganancia.",
      },
      {
        titulo: "Utilidad en el peor 5 %",
        ejemplo: "49,1 M · sin cobertura: 32,4 M",
        que: "Descarte los 9.500 mejores caminos de 10.000 y mire los 500 peores. Esta es la utilidad ahí.",
        ojo: "Es la cifra que decide, porque es la que lo quiebra. Todas las recomendaciones de esta herramienta salen de ella.",
      },
      {
        titulo: "VaR 95 %",
        ejemplo: "9,3 M · sin cobertura: 25,7 M",
        que: "Cuánto puede apartarse el resultado de lo esperado en un mal día, con 95 % de confianza.",
        ojo: "El VaR no incluye el riesgo de base. El percentil 5 sí. Cuando discrepan, hágale caso al percentil 5.",
      },
    ],
  },
  {
    seccion: "La tabla de estrategias",
    intro:
      "Cada fila es una forma de cubrirse. Mire dos columnas juntas: «Caso base» es lo que gana si nada se mueve, y «Percentil 5» es su mal día. La buena estrategia sube el segundo sin bajar el primero.",
    cifras: [
      {
        titulo: "Contratos",
        que: "Cuántos contratos de 10 TM se compran o se venden en la bolsa. Un contrato no se puede partir.",
      },
      {
        titulo: "Caso base",
        que: "Lo que gana si el precio, la tasa de cambio y el diferencial se quedan donde están.",
      },
      {
        titulo: "Peor caso y Mejor caso",
        que: "Los dos extremos de los 63 escenarios dibujados a mano. No son lo peor que puede pasar: son lo peor de esa rejilla.",
      },
      {
        titulo: "P(pérdida) y VaR",
        que: "Lo mismo que en las tarjetas de arriba, pero para cada estrategia.",
      },
      {
        titulo: "Costo inicial",
        que: "Lo que paga por adelantado. Solo las estrategias con opciones cuestan; los futuros no tienen prima.",
        ojo: "Un costo inicial alto con un caso base peor casi nunca compensa. Compare esa columna con lo que gana en el percentil 5.",
      },
    ],
  },
  {
    seccion: "Los tres dibujos",
    cifras: [
      {
        titulo: "Perfil de resultado",
        que: "Dónde termina su utilidad según dónde termine el cacao. Una línea inclinada significa que el precio le importa; una línea plana, que dejó de importarle.",
        ojo: "Plana es el objetivo. Eso es cubrirse.",
      },
      {
        titulo: "Matriz de escenarios",
        que: "63 casillas: las filas mueven el cacao de −30 % a +30 %, las columnas mueven la tasa de cambio, y el selector de arriba mueve el diferencial.",
        ojo: "Si todas las casillas están en verde, no hay escenario de la rejilla en que pierda. Si hay rojo, fíjese en qué esquina está.",
      },
      {
        titulo: "Distribución Monte Carlo",
        que: "Los 10.000 caminos simulados, apilados por resultado. La montaña muestra dónde caen casi todos; la rayita marca el percentil 5.",
        ojo: "Cuanto más angosta la montaña, más predecible el resultado. Cubrirse la angosta.",
      },
    ],
  },
  {
    seccion: "Llamadas de margen",
    intro: "La parte que sorprende a quien se cubre por primera vez.",
    cifras: [
      {
        titulo: "Capital inmovilizado",
        ejemplo: "24,9 M COP",
        que: "Lo que la bolsa le retiene para dejarle abrir la posición. No lo pierde, pero no lo puede usar.",
      },
      {
        titulo: "Primera llamada si el futuro…",
        ejemplo: "baja a 5.881 USD/TM",
        que: "A partir de ese precio, la bolsa le pide plata adicional.",
        ojo: "No es una pérdida de verdad: el físico se movió a su favor al mismo tiempo. Pero la caja sale hoy y el ahorro llega el día del embarque. Esa diferencia de tiempos es la que hay que tener resuelta antes de cubrirse.",
      },
      {
        titulo: "Peor llamada de la matriz",
        que: "El desembolso más grande que le pedirían en los escenarios simulados. Téngalo disponible.",
      },
    ],
  },
  {
    seccion: "El dólar",
    intro:
      "Una segunda decisión, separada de la del cacao. Cubrir el precio no toca el riesgo cambiario.",
    cifras: [
      {
        titulo: "Vende a plazo",
        que: "Cuántos dólares le vendería al banco a una tasa pactada hoy, en vez de cambiarlos el día que los reciba.",
      },
      {
        titulo: "Tasa forward",
        ejemplo: "3.115,17 · 5,87 pesos por encima de la TRM",
        que: "La tasa que puede pactar hoy para una fecha futura. Sale del diferencial de tasas entre Colombia y Estados Unidos, no de un pronóstico.",
        ojo: "Como las tasas en pesos son más altas, la forward queda por encima de la TRM: vender dólares a plazo le paga. Lo que entrega es la ganancia si el peso se devalúa.",
      },
      {
        titulo: "Por qué a veces casi no cambia nada",
        que: "A 14 días el dólar no alcanza a moverse y la tabla se ve plana. A 90 días la misma tabla puede multiplicar su peor caso por cinco.",
        ojo: "Entre más lejos la fecha, más importa el dólar.",
      },
    ],
  },
  {
    seccion: "Dimensionamiento",
    intro:
      "Un contrato son 10 toneladas exactas y no se puede partir. Casi nunca calza con lo que usted tiene.",
    cifras: [
      {
        titulo: "Subcobertura",
        que: "Cubre de menos y deja toneladas expuestas al movimiento del precio.",
      },
      {
        titulo: "Sobrecobertura",
        que: "Cubre de más. Las toneladas de sobra quedan como posición en bolsa sin físico detrás.",
        ojo: "Eso ya no es cobertura, es especulación. La herramienta se lo dice con esas palabras cuando pasa.",
      },
      {
        titulo: "«7,65 TM equivalen a 0,77 contratos»",
        que: "Con diferencial porcentual las toneladas expuestas no son las físicas. Si compra un 23,5 % por debajo de la bolsa, solo está expuesto al 76,5 % del movimiento, y eso es lo que hay que cubrir.",
      },
    ],
  },
];

export default function PaginaCoquito() {
  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Qué significa cada cifra</h1>
          <Link href="/guia" className="text-sm text-texto-suave hover:text-texto">
            ← Guía
          </Link>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          Recorrido de la pantalla de resultados, en el orden en que aparece. Para cada
          número: qué es, qué quiere decir, y qué conviene tener en cuenta. Los ejemplos
          salen de un análisis real.
        </p>
      </header>

      {BLOQUES.map((bloque) => (
        <section key={bloque.seccion} aria-labelledby={bloque.seccion} className="space-y-4">
          <div className="space-y-1">
            <h2 id={bloque.seccion} className="text-sm font-semibold">
              {bloque.seccion}
            </h2>
            {bloque.intro ? (
              <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
                {bloque.intro}
              </p>
            ) : null}
          </div>

          <div className="divide-y divide-borde border-y border-borde">
            {bloque.cifras.map((cifra) => (
              <div key={cifra.titulo} className="space-y-1.5 py-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-sm font-medium">{cifra.titulo}</h3>
                  {cifra.ejemplo ? (
                    <span className="tabular rounded border border-borde px-1.5 py-0.5 text-xs text-texto-suave">
                      {cifra.ejemplo}
                    </span>
                  ) : null}
                </div>

                <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
                  {cifra.que}
                </p>

                {cifra.ojo ? (
                  <p className="max-w-prose border-l-2 border-ambar pl-3 text-sm leading-relaxed">
                    <span className="font-medium">Ojo:</span>{" "}
                    <span className="text-texto-suave">{cifra.ojo}</span>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Si solo se lleva tres cosas</h2>
        <ol className="space-y-3">
          {[
            "Mire primero el colchón: la distancia entre el futuro de hoy y su punto de equilibrio. Si es grande, casi no tiene riesgo y la cobertura es opcional.",
            "Después mire el percentil 5, no el promedio. Es el número que decide, porque es el que lo quiebra.",
            "Y antes de cubrirse con futuros, tenga resuelta la caja de las llamadas de margen. Es lo único que puede salir mal aunque la cobertura esté bien puesta.",
          ].map((texto, i) => (
            <li key={texto} className="grid grid-cols-[1.5rem_1fr] gap-3 text-sm leading-relaxed">
              <span className="tabular border-b border-borde pb-0.5 text-xs text-ambar">
                {i + 1}
              </span>
              <span className="max-w-prose text-texto-suave">{texto}</span>
            </li>
          ))}
        </ol>

        <Link
          href="/analisis/nuevo"
          className="inline-block rounded-md bg-cacao px-3 py-2 text-sm font-medium text-white transition hover:bg-cacao-claro"
        >
          Hacer un análisis
        </Link>
      </section>

      <Disclaimer />
    </div>
  );
}
