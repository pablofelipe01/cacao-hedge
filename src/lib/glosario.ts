/**
 * Qué quiere decir cada cifra de la pantalla de resultados.
 *
 * Fuente ÚNICA de esas explicaciones. Las consumen dos sitios: el popup
 * que sale al tocar una cifra, y la página `/guia/resultados` que las
 * lista todas. Duplicar el texto en los dos habría bastado para que en
 * tres meses dijeran cosas distintas del mismo número.
 *
 * El contenido salió de una sesión real leyendo un análisis con el
 * exportador: sus preguntas nunca fueron «¿qué es una cobertura?», sino
 * «¿qué me está diciendo este número?». Por eso cada entrada tiene un
 * `que` —la definición— y casi siempre un `ojo`: lo que hay que tener en
 * cuenta y que la definición sola no transmite.
 */

export interface EntradaGlosario {
  /** Cómo aparece en pantalla. */
  titulo: string;
  /** Un valor real de ejemplo, para anclar la explicación. */
  ejemplo?: string;
  /** Qué es, en una o dos frases. */
  que: string;
  /** Lo que conviene tener en cuenta. */
  ojo?: string;
}

export type ClaveGlosario = keyof typeof GLOSARIO;

export const GLOSARIO = {
  // --- Cabecera --------------------------------------------------------
  toneladas: {
    titulo: "Toneladas de la operación",
    que: "Cuántas toneladas están en juego, y si ya son suyas o le faltan por comprar. De eso depende si la cobertura se vende o se compra.",
  },
  diferencial: {
    titulo: "Diferencial (o base)",
    ejemplo: "−23,5 % de NY",
    que: "La distancia entre el precio de Nueva York y lo que usted paga o cobra de verdad. Negativo significa por debajo de la bolsa, que al comprar en Colombia es lo normal.",
    ojo: "Es el número que más mueve el análisis, y el único que la cobertura con futuros NO fija. Si lo puso de memoria, vaya a Precios y use el medido.",
  },

  // --- Tarjetas de mercado ---------------------------------------------
  futuro: {
    titulo: "Futuro CC de referencia",
    ejemplo: "5.961 USD/TM · vol. 53,4 %",
    que: "A cuánto está el cacao en la bolsa de Nueva York. La «vol» dice cuánto se mueve ese precio: 53 % significa que en un año puede variar la mitad de su valor.",
    ojo: "Esa volatilidad es alta comparada con casi cualquier otra materia prima. Es la razón de que este ejercicio tenga sentido.",
  },
  trm: {
    titulo: "TRM",
    ejemplo: "3.109,30 COP/USD",
    que: "Cuántos pesos vale un dólar hoy, según la tasa oficial que certifica la Superintendencia Financiera.",
    ojo: "Su cacao cotiza en dólares pero usted vive en pesos: esta tasa es la mitad de su riesgo, y cubrirla es una decisión aparte.",
  },
  exposicion: {
    titulo: "Exposición nominal · Costo esperado de la compra",
    ejemplo: "141,8 M COP",
    que: "Cuánta plata está sujeta al vaivén del precio. Con inventario es lo que espera cobrar; con una venta ya cerrada, lo que espera pagar para abastecerse.",
    ojo: "No es una pérdida ni una ganancia: es el tamaño de lo que está en juego.",
  },
  equilibrio: {
    titulo: "Punto de equilibrio · Precio máximo de compra",
    ejemplo: "8.497 USD/TM",
    que: "Su frontera. Con inventario, el precio mínimo al que puede vender sin perder. Con una venta cerrada, el precio máximo al que puede comprar.",
    ojo: "Compárelo con el futuro de hoy: esa distancia es su colchón, y es lo primero que hay que mirar. Si es grande, casi no tiene riesgo y la cobertura pasa a ser opcional.",
  },

  // --- Qué cambia cubrirse ----------------------------------------------
  probabilidadPerdida: {
    titulo: "Probabilidad de pérdida",
    ejemplo: "0,0 % · sin cobertura: 0,1 %",
    que: "De cada 100 caminos simulados del precio y la tasa de cambio, en cuántos la operación termina en rojo.",
    ojo: "Si sin cubrirse ya es muy baja, cubrirse no le está salvando el negocio: le está asegurando una ganancia. Son cosas distintas.",
  },
  percentil5: {
    titulo: "Utilidad en el peor 5 %",
    ejemplo: "49,1 M · sin cobertura: 32,4 M",
    que: "Descarte los 9.500 mejores caminos de 10.000 y mire los 500 peores. Esta es la utilidad ahí.",
    ojo: "Es la cifra que decide, porque es la que lo quiebra. Todas las recomendaciones de esta herramienta salen de ella, no del promedio.",
  },
  var: {
    titulo: "VaR 95 %",
    ejemplo: "9,3 M · sin cobertura: 25,7 M",
    que: "Cuánto puede apartarse el resultado de lo esperado en un mal día, con 95 % de confianza.",
    ojo: "El VaR no incluye el riesgo de base; el percentil 5 sí. Cuando los dos discrepan, hágale caso al percentil 5.",
  },

  // --- Columnas de la tabla ---------------------------------------------
  contratos: {
    titulo: "Contratos",
    que: "Cuántos contratos de 10 toneladas se compran o se venden en la bolsa.",
    ojo: "Un contrato no se puede partir, y casi nunca calza con lo que usted tiene. Ese descalce obligatorio es su primera decisión.",
  },
  casoBase: {
    titulo: "Caso base",
    que: "Lo que gana si el precio, la tasa de cambio y el diferencial se quedan exactamente donde están hoy.",
    ojo: "Léalo junto al percentil 5. La buena estrategia sube el segundo sin bajar el primero.",
  },
  extremos: {
    titulo: "Peor caso y Mejor caso",
    que: "Los dos extremos de los 63 escenarios dibujados a mano.",
    ojo: "No son lo peor que puede pasar en el mundo: son lo peor de esa rejilla. Para la cola de verdad, mire el percentil 5.",
  },
  costoInicial: {
    titulo: "Costo inicial",
    que: "Lo que paga por adelantado para montar la estrategia. Solo las que llevan opciones cuestan; los futuros no tienen prima.",
    ojo: "Un costo inicial alto con un caso base peor casi nunca compensa. Compare esa columna con lo que gana en el percentil 5.",
  },

  // --- Gráficos ----------------------------------------------------------
  perfil: {
    titulo: "Perfil de resultado",
    que: "Dónde termina su utilidad según dónde termine el cacao. Una línea inclinada significa que el precio le importa; una línea plana, que dejó de importarle.",
    ojo: "Plana es el objetivo. Eso es exactamente lo que quiere decir «cubrirse».",
  },
  matriz: {
    titulo: "Matriz de escenarios",
    que: "63 casillas: las filas mueven el cacao de −30 % a +30 %, las columnas mueven la tasa de cambio, y el selector de arriba mueve el diferencial.",
    ojo: "Si todas están en verde, no hay escenario de la rejilla en que pierda. Si hay rojo, fíjese en qué esquina está: le dice qué combinación lo lastima.",
  },
  monteCarlo: {
    titulo: "Distribución Monte Carlo",
    que: "Los 10.000 caminos simulados, apilados por resultado. La montaña muestra dónde caen casi todos; la rayita marca el percentil 5.",
    ojo: "Cuanto más angosta la montaña, más predecible el resultado. Cubrirse la angosta.",
  },

  // --- Márgenes -----------------------------------------------------------
  capitalInmovilizado: {
    titulo: "Capital inmovilizado",
    ejemplo: "24,9 M COP",
    que: "Lo que la bolsa le retiene para dejarle abrir la posición. No lo pierde, pero no lo puede usar mientras la cobertura esté viva.",
  },
  disparadorMargen: {
    titulo: "Primera llamada de margen",
    ejemplo: "si el futuro baja a 5.881 USD/TM",
    que: "A partir de ese precio, la bolsa le pide plata adicional para sostener la posición.",
    ojo: "No es una pérdida de verdad: el físico se movió a su favor al mismo tiempo. Pero la caja sale hoy y el ahorro llega el día del embarque, y esa diferencia de tiempos es lo único que puede salir mal aunque la cobertura esté bien puesta.",
  },
  peorLlamada: {
    titulo: "Peor llamada de la matriz",
    que: "El desembolso más grande que le pedirían en los escenarios simulados.",
    ojo: "Téngalo disponible antes de abrir la posición, no después.",
  },

  // --- Dólar ---------------------------------------------------------------
  forward: {
    titulo: "Tasa forward",
    ejemplo: "3.115,17 · 5,87 pesos sobre la TRM",
    que: "La tasa que puede pactar hoy con su banco para una fecha futura. Sale del diferencial de tasas entre Colombia y Estados Unidos, no de un pronóstico de nadie.",
    ojo: "Como las tasas en pesos son más altas, la forward queda por encima de la TRM: vender dólares a plazo le PAGA, no le cuesta. Lo que entrega es la ganancia si el peso se devalúa.",
  },
  ventaPlazo: {
    titulo: "Vende a plazo",
    que: "Cuántos dólares le vendería al banco a la tasa pactada, en vez de cambiarlos el día que los reciba.",
    ojo: "El monto sale del flujo neto en dólares —lo que de verdad va a convertir—, no del valor del lote.",
  },

  // --- Dimensionamiento ------------------------------------------------------
  subcobertura: {
    titulo: "Subcobertura",
    que: "Cubrir de menos, dejando toneladas expuestas al movimiento del precio.",
  },
  sobrecobertura: {
    titulo: "Sobrecobertura",
    que: "Cubrir de más. Las toneladas de sobra quedan como posición en bolsa sin físico detrás.",
    ojo: "Eso ya no es cobertura: es especulación. La herramienta se lo dice con esas palabras cuando ocurre.",
  },
  toneladasExpuestas: {
    titulo: "Toneladas expuestas",
    ejemplo: "7,65 TM de 10 físicas",
    que: "Con diferencial porcentual, las toneladas expuestas no son las físicas. Si compra un 23,5 % por debajo de la bolsa, su costo solo se mueve el 76,5 % de lo que se mueve Nueva York.",
    ojo: "Por eso hay que cubrir 7,65 y no 10. Cubrir las diez sería quedar comprado sobre 2,35 toneladas que nadie le pidió.",
  },

  // --- Pantalla de precios ------------------------------------------------
  precioProductor: {
    titulo: "Precio hoy",
    ejemplo: "14.400 COP/kg",
    que: "Lo que ese comprador publicó como precio de compra del kilo de cacao el último día con datos. Es el precio contra el que usted compite para conseguir grano.",
  },
  nyEnPesos: {
    titulo: "Nueva York en pesos",
    ejemplo: "19.080 COP/kg",
    que: "El futuro de Nueva York del mismo día, pasado a pesos por kilo con la TRM de ese día. Sirve para comparar peras con peras: los dos precios en la misma unidad.",
  },
  descuentoHoy: {
    titulo: "Descuento hoy",
    ejemplo: "−24,5 %",
    que: "Cuánto por debajo de Nueva York está pagando ese comprador hoy. Es la distancia entre las dos columnas anteriores.",
    ojo: "Es el número que el formulario de análisis le propone cuando le falta comprar el cacao.",
  },
  descuentoHabitual: {
    titulo: "Descuento habitual",
    ejemplo: "−23,0 %",
    que: "El descuento de un día típico: la mitad de los días estuvo por encima y la otra mitad por debajo.",
    ojo: "Si el de hoy está lejos del habitual, el mercado local está raro: más caro o más barato que de costumbre frente a la bolsa.",
  },
  rangoNormal: {
    titulo: "Rango normal",
    ejemplo: "−31,8 % a −15,1 %",
    que: "Entre qué valores se movió el descuento 9 de cada 10 días. Se dejan fuera el 5 % de días más extremos por cada lado.",
    ojo: "Ese vaivén es el riesgo de base: la parte que ninguna cobertura con futuros toca, porque es un riesgo del mercado colombiano y no de Nueva York.",
  },
} as const satisfies Record<string, EntradaGlosario>;

/** Las entradas agrupadas como aparecen en pantalla, para la guía. */
export const SECCIONES_GLOSARIO: { seccion: string; intro?: string; claves: ClaveGlosario[] }[] = [
  {
    seccion: "La cabecera",
    intro:
      "La línea de arriba resume qué operación está mirando. Si algo ahí no coincide con su realidad, todo lo demás sobra.",
    claves: ["toneladas", "diferencial"],
  },
  {
    seccion: "Las cuatro tarjetas",
    claves: ["futuro", "trm", "exposicion", "equilibrio"],
  },
  {
    seccion: "Qué cambia cubrirse",
    intro: "Las tres cifras que comparan cubrirse contra no hacer nada.",
    claves: ["probabilidadPerdida", "percentil5", "var"],
  },
  {
    seccion: "La tabla de estrategias",
    intro:
      "Cada fila es una forma de cubrirse. Mire dos columnas juntas: «Caso base» es lo que gana si nada se mueve, y «Percentil 5» es su mal día.",
    claves: ["contratos", "casoBase", "extremos", "costoInicial"],
  },
  {
    seccion: "Los tres dibujos",
    claves: ["perfil", "matriz", "monteCarlo"],
  },
  {
    seccion: "Llamadas de margen",
    intro: "La parte que sorprende a quien se cubre por primera vez.",
    claves: ["capitalInmovilizado", "disparadorMargen", "peorLlamada"],
  },
  {
    seccion: "El dólar",
    intro:
      "Una segunda decisión, separada de la del cacao. Cubrir el precio no toca el riesgo cambiario.",
    claves: ["forward", "ventaPlazo"],
  },
  {
    seccion: "Dimensionamiento",
    intro:
      "Un contrato son 10 toneladas exactas y no se puede partir. Casi nunca calza con lo que usted tiene.",
    claves: ["subcobertura", "sobrecobertura", "toneladasExpuestas"],
  },
  {
    seccion: "La pantalla de precios",
    intro:
      "Lo que pagan Nacional de Chocolates y Casa Luker, comparado con Nueva York. De ahí sale el descuento al que usted compra.",
    claves: ["precioProductor", "nyEnPesos", "descuentoHoy", "descuentoHabitual", "rangoNormal"],
  },
];
