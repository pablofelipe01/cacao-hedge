# CacaoHedge

Aplicación de apoyo a decisiones de cobertura (*hedging*) para exportadores
colombianos de cacao. Toma un lote de inventario físico y devuelve el análisis
de cobertura con futuros y opciones de cacao de ICE (símbolo **CC**, Nueva
York), escenarios de precio, exposición cambiaria COP/USD y un informe
ejecutivo narrativo en español.

> **Aviso:** herramienta de apoyo a decisiones. **No constituye asesoría
> financiera, de inversión ni tributaria.**

---

## Estado del proyecto

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Scaffold Next.js + Supabase (schema, RLS, auth) + `.env.example` | ✅ Completa |
| 2 | Motor de cálculo puro con tests (contratos, estrategias, escenarios, VaR, Monte Carlo) | ✅ Completa |
| 3 | Capa de datos (Yahoo, Barchart, TRM, caché) | ✅ Completa |
| 4 | UI de formulario y resultados con gráficos | ✅ Completa |
| 5 | Informe narrativo con Anthropic + exportación PDF | ✅ Completa |
| 6 | Historial, configuración de supuestos, pulido | ✅ Completa |

---

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # y complete los valores
npm run dev                  # http://localhost:3000
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Turbopack) |
| `npm run build` | Build de producción + chequeo de tipos |
| `npm test` | Tests unitarios (Vitest) — 326 tests |
| `npm run test:watch` | Tests en modo observación |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

### Variables de entorno

Todas están documentadas en `.env.example`. Las imprescindibles para
arrancar son `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
`SUPABASE_SERVICE_ROLE_KEY` y `ANTHROPIC_API_KEY` hacen falta desde la fase 3
y la fase 5 respectivamente.

---

## Base de datos

Proyecto Supabase: **`cacao-hedge`**. Las migraciones viven en
`supabase/migrations/` y ya están aplicadas al proyecto remoto.

| Tabla | Contenido | Acceso |
|---|---|---|
| `inventarios` | Lotes de cacao: toneladas, costo COP/kg, ubicación, fecha de embarque, diferencial USD/TM, tipo de contrato de venta | RLS: solo el dueño |
| `precios` | Caché OHLC diaria de CC (USD/TM) y de la TRM (COP/USD) | Lectura para autenticados; escritura solo `service_role` |
| `analisis` | Snapshot reproducible por corrida: entradas, mercado, supuestos, resultados e informe | RLS: solo el dueño |
| `configuracion` | Supuestos por usuario: márgenes, comisiones, tasa, VaR, trayectorias Monte Carlo | RLS: solo el dueño |

Un trigger sobre `auth.users` crea la fila de `configuracion` con valores por
defecto al registrarse cada usuario, de modo que la app nunca opera sin
supuestos.

**Márgenes por defecto (8.000 / 7.200 USD por contrato):** son un punto de
partida documentado, no un dato de ICE en tiempo real. ICE ajusta el margen del
CC con frecuencia — en 2024 superó los 20.000 USD/contrato. Son editables en
`configuracion` y deben confirmarse con el bróker.

### Regenerar tipos tras cambiar el schema

```bash
npx supabase gen types typescript --project-id <ref> > src/types/database.ts
```

---

## Motor de cálculo (`src/lib/engine`)

TypeScript puro: sin I/O, sin reloj del sistema, sin aleatoriedad sin semilla.
Guardar las entradas de un análisis basta para reproducirlo bit a bit meses
después. 98 % de cobertura de sentencias.

| Módulo | Responsabilidad |
|---|---|
| `constantes.ts` | Especificación del contrato CC: 10 TM, tick 1 USD/TM = 10 USD, vencimientos H K N U Z |
| `tipos.ts` | Tipos del dominio y `SUPUESTOS_POR_DEFECTO` |
| `numerico.ts` | Normal acumulada e inversa, PRNG sembrado (mulberry32), Box-Muller, percentiles |
| `fx.ts` | COP↔USD, costo COP/kg → COP/TM, precio efectivo del físico, punto de equilibrio |
| `contratos.ts` | Sub/sobrecobertura y exposición residual |
| `volatilidad.ts` | Volatilidad histórica anualizada con respaldo ante series pobres |
| `opciones.ts` | Black-76 (primas y griegas), collar de costo cero |
| `escenarios.ts` | Matriz determinística 7 × 3 × 3 = 63 escenarios |
| `estrategias.ts` | Catálogo de 9 estrategias y su evaluación por escenario |
| `riesgo.ts` | Exposición delta-ajustada, VaR paramétrico 95 %, llamadas de margen |
| `montecarlo.ts` | GBM correlacionado con variables antitéticas, 10.000 trayectorias |
| `index.ts` | `analizarCobertura()`: orquesta todo y recomienda |

### Decisiones de modelado que conviene conocer

**La cobertura con futuros fija el futuro, no la base ni la TRM.** Con
cobertura total el ingreso equivale a vender a `F₀ + base`, sea cual sea el
precio final: el futuro queda cerrado. Pero mover el diferencial ±100 USD/TM
o la TRM ±10 % sí cambia el resultado. Hay tests que fijan exactamente esa
propiedad, porque es el malentendido más caro del negocio.

**Deriva cero en el Monte Carlo.** Un futuro es una martingala bajo la medida
neutral al riesgo: su mejor predictor es el precio de hoy. Ponerle tendencia
sería incorporar una opinión de mercado, y este motor no opina sobre la
dirección del precio.

**Variables antitéticas.** Cada trayectoria se simula junto con su reflejo
(−Z). Sin esa corrección, comparar dos estrategias por su utilidad media
producía diferencias de varios millones de pesos que eran ruido del
simulador. La recomendación además calla la comparación de medias cuando la
diferencia no supera dos errores estándar, en vez de reportar ruido con
precisión de pesos.

**Empate en el dimensionamiento.** Cuando subcubrir y sobrecubrir dejan el
mismo residual (p. ej. 75 TM = 7,5 contratos), se prefiere subcubrir: dejar
físico sin cubrir es menos grave que vender lo que no se tiene.

**Momento de conversión a COP.** Las primas se desembolsan hoy y se convierten
a la TRM vigente; el ingreso del físico, el resultado de la cobertura y las
comisiones ocurren en el embarque y se convierten a la TRM del escenario. La
liquidación diaria de los futuros contra la cámara se consolida en la fecha de
embarque.

**Criterio de recomendación.** Se maximiza el percentil 5 de la utilidad
simulada, no la utilidad media: un exportador con inventario financiado no se
juega la empresa por el promedio sino por el mal escenario.

**El VaR paramétrico asume normalidad y exposición lineal**, así que subestima
las colas y trata mal la convexidad de las opciones. El Monte Carlo existe
para complementarlo, no para repetirlo.

---

## Inventario real desde la hoja operativa

`/bodega` refleja la columna **CANTIDAD DISPONIBLE EN BODEGA** de la hoja de
cálculo de operaciones. La hoja manda: cada sincronización reemplaza lo que
hubiera en la tabla `inventario_bodega`, y se guarda el número de fila de origen
para poder rastrear cualquier cifra hasta la celda de donde salió.

### Dos trampas de la hoja que el parser resuelve

**Hay dos columnas llamadas «CANTIDAD DISPONIBLE EN BODEGA».** Una en la sección
ENTRADAS (columna O, la que cuenta) y otra en CLASIFICACION desglosada por
calidad. Buscar la columna por nombre a secas tomaría la equivocada; el parser
usa la primera y verifica que vaya después de «CANTIDAD SALIDA», fallando con un
mensaje claro si alguien reordena la hoja.

**El encabezado ocupa tres filas** y los números vienen en convención colombiana
entrecomillada (`"1580,6"`), con errores de fórmula `#DIV/0!` en las filas sin
datos. Las fechas usan meses abreviados en español (`9-sept-2026`).

El importador coteja su propia suma contra el total que declara la hoja y avisa
si no cuadran, en vez de dar por buena una cifra que quizá perdió filas.

### Lo que hay que saber al usarlo

La lectura usa la exportación pública a CSV de Google, que funciona cuando la
hoja está compartida por enlace. Esa comodidad tiene contrapartida: **cualquiera
con el enlace puede leer el inventario**. Es una decisión del dueño de la hoja,
no de esta aplicación, pero conviene tenerla presente.

La hoja sabe cuánto cacao hay y a qué se compró; no sabe la fecha de embarque ni
el diferencial pactado, que son decisiones comerciales. Por eso `/bodega` no
sustituye a `inventarios`: prefija la cantidad y el costo en el formulario de
análisis, y el resto lo pone el usuario.

---

## Historial y supuestos (fase 6)

**El historial compara decisiones, no recalcula.** Cada análisis guardó su propia
fotografía de mercado y sus supuestos, así que la ficha del lote muestra cómo
cambió la recomendación al moverse el precio. En los datos de prueba se ve: los
análisis contra el continuo de Yahoo daban 13,6 % de probabilidad de pérdida sin
cubrir, y el mismo lote contra el histórico real de CCZ26 da 18,0 %, porque la
volatilidad medida sobre 426 días reales es mayor.

**Cambiar los supuestos no toca lo ya calculado.** Esa inmutabilidad es lo que
permite reabrir un análisis de hace meses y que las cifras sigan cuadrando.

### Dos defectos que solo aparecieron al usar la aplicación

**`vol_fallback` era configuración muerta.** La columna existía en la tabla desde
la fase 1 y la pantalla iba a exponerla, pero ningún código la leía: la capa de
datos usaba una constante del módulo. Una opción que no hace nada es peor que no
tenerla, así que se conectó antes de ponerla en la interfaz.

**El punto decimal era ambiguo y rompía el formulario.** El navegador rellena los
valores por defecto con el punto de JavaScript (`4.25`), mientras que en Colombia
el punto separa miles. El parser trataba todo punto como separador de miles, así
que una tasa del 4,25 % se leía como 425 % y el formulario fallaba sin que el
usuario hubiera tocado nada. Ahora `interpretarNumero` resuelve la ambigüedad:
con ambos separadores manda el último; solo con punto, separa miles si agrupa de
tres en tres (`14.500`) y es decimal en cualquier otro caso (`4.25`).

---

## Informe narrativo (fase 5)

Un modelo de lenguaje redacta el informe ejecutivo a partir de los resultados
ya calculados. **El modelo no calcula nada**: todas las cifras salen del motor
de `src/lib/engine`, que está testeado; el modelo interpreta, redacta y señala
los riesgos que ningún número captura.

| Módulo | Responsabilidad |
|---|---|
| `resumen.ts` | Extrae del análisis un resumen compacto: solo las cifras citables |
| `prompt.ts` | Prompt de sistema, con la prohibición de inventar cifras |
| `informe.ts` | Llamada a la API, errores tipados y verificación |
| `verificacion.ts` | **Comprueba que ninguna cifra del texto fue inventada** |
| `cliente.ts` | Cliente del SDK, con `server-only` para que la API key no salga |

### La verificación de cifras

Prohibirle al modelo que invente números es necesario pero no suficiente: una
instrucción es una petición, no una garantía. Así que se comprueba.

Tras generar el informe se extrae **cada cifra del texto** y se busca en el
resumen que se le entregó, aceptando cualquier forma de escribirla —
`652.200.000`, «652,2 millones», «657 M» son el mismo valor— y el valor
absoluto, porque una pérdida suele redactarse en positivo. Lo que no rastree a
un dato de entrada se reporta, y la interfaz lo muestra: si todo cuadra dice
«las N cifras citadas corresponden a valores del análisis»; si no, nombra las
dudosas y pide contrastarlas con la tabla.

No bloquea la entrega — un informe con una cifra dudosa sigue sirviendo — pero
el usuario se entera en vez de recibirlo como palabra sagrada.

*Resultado medido:* dos generaciones independientes con datos reales, **88/88 y
86/86 cifras rastreables**. Ninguna inventada.

El resumen que se envía es un extracto, no el análisis completo: mandar los 63
escenarios por cada una de las nueve estrategias sería derrochar tokens y, sobre
todo, ampliar la superficie donde el modelo puede equivocarse.

### Exportación a PDF

El botón abre el diálogo de impresión del navegador. Es deliberado: una librería
de PDF en el cliente pesa cientos de kilobytes, rasteriza mal los gráficos SVG y
obliga a mantener un segundo motor de maquetación. Imprimir respeta el tamaño de
papel del usuario y los gráficos salen vectoriales.

A cambio, la calidad depende por completo del `@media print` de `globals.css`,
que por eso invierte el tema a tinta sobre papel, oculta la navegación, evita
partir gráficos y tablas entre páginas, fuerza la impresión de los fondos de
color del heatmap —que son el dato, no decoración— y añade el aviso legal al
pie del documento.

---

## Interfaz (fase 4)

| Ruta | Qué hace |
|---|---|
| `/dashboard` | Lotes activos, total en TM y su equivalente en contratos, análisis recientes |
| `/inventarios/nuevo` | Alta de lote; al guardar abre el análisis precargado |
| `/analisis/nuevo` | Formulario del análisis, rellenable desde un lote |
| `/analisis/[id]` | Resultados: métricas, tabla comparativa, payoff, heatmap, Monte Carlo y márgenes |
| `/bodega` | Inventario real sincronizado desde la hoja operativa |
| `/inventarios/[id]` | Ficha del lote e historial de sus análisis |
| `/configuracion` | Supuestos de cálculo del usuario |
| `/importar` | Importación de históricos en CSV a la caché (arrastrar y soltar) |

### Decisiones de visualización

La paleta de datos **no** usa los tonos de marca: los marrones del cacao visten
el cromo de la interfaz, pero los datos se pintan con una paleta validada con un
verificador de separación perceptual contra las superficies reales de la app
(clara `#ffffff`, oscura `#1f1a17`). La marca no está validada para eso.

**El heatmap es divergente, no secuencial.** La utilidad tiene un punto medio con
significado —el cero, donde el lote deja de ganar y empieza a perder—, así que la
escala son dos polos opuestos con gris neutro al centro. Se usa **azul ↔ rojo en
vez del verde ↔ rojo habitual en finanzas**: ese par es justamente el que un
daltónico protán o deután no distingue, y aquí la diferencia entre ganar y perder
no puede depender de eso. La escala se normaliza con el extremo absoluto de toda
la matriz, no con el mínimo y el máximo del corte visible: si cambiara al mover
el selector de base, los colores dejarían de ser comparables entre cortes.

**El heatmap enseña el riesgo de base.** Con cobertura total, las filas (precio
del futuro) apenas cambian mientras las columnas (TRM) cambian muchísimo. Esa
asimetría visual es el argumento entero de la herramienta.

**Escalas de magnitud.** Se escribe «mil M» y nunca «MM» para los miles de
millones: en Colombia «MM» se lee habitualmente como millones, y equivocarse por
un factor de mil en una cifra de cobertura no es un detalle tipográfico.

**Cuatro líneas en el perfil de resultado, no nueve.** Cubren las cuatro formas
distintas —diagonal, plana, rodilla y meseta—; el resto vive en la tabla, que
además cumple la regla de relieve para los dos colores que quedan por debajo de
3:1 de contraste sobre la superficie clara.

### Cómo cargar el histórico de cacao

1. En barchart.com, abra el contrato y vaya a su **Price History** (histórico de
   precios) con la sesión iniciada:
   - `https://www.barchart.com/futures/quotes/CC*1/price-history/daily` — continuo
     del mes frontal, que es el que conviene para estimar volatilidad porque no
     tiene saltos de vencimiento.
   - `https://www.barchart.com/futures/quotes/CCZ26/price-history/daily` —
     vencimiento concreto, si quiere cubrir contra ese.
2. Elija periodicidad **diaria** y el rango más largo que le permita la cuenta
   (un año basta; dos son mejores) y descargue el CSV.
3. Súbalo en `/importar`. El parser acepta el archivo tal cual, sin editar nada:
   - reconoce **`Time`** como fecha y **`Latest`** como cierre, que es como los
     nombra el export de futuros (además de `Date`/`Close`/`Last`);
   - si no hay columna `Symbol`, deduce el contrato del nombre del archivo
     (`ccz26_price-history-…` → `CCZ26`), validando que tenga forma de futuro;
   - descarta la línea de pie («Downloaded from Barchart.com as of…») e informa
     cuántas filas ignoró.
4. En `/analisis/nuevo`, elija ese contrato en **Contrato de referencia**. Sin
   ese paso el análisis seguiría usando el continuo de Yahoo y el CSV quedaría
   sin utilizar.

El sistema avisa si el contrato elegido **no registró volumen el último día**:
un vencimiento expirado sigue publicando precio pero ya no refleja el mercado,
y arrastraría todo el análisis.

Las series de distinta fuente conviven sin mezclarse: `CC=F` de Yahoo y `CCZ26`
del CSV son filas distintas, porque la caché se indexa por (símbolo, fecha,
fuente).

---

## Capa de datos (`src/lib/data`)

La aplicación nunca habla con Yahoo ni con Barchart directamente: habla con
la interfaz `PriceProvider`. Cambiar de fuente es sustituir una clase.

| Módulo | Responsabilidad |
|---|---|
| `tipos.ts` | `PriceProvider`, `Barra`, `SerieHistorica`, `Cotizacion` |
| `errores.ts` | `ErrorDatos` con causa tipada, si es reintentable y mensaje en español |
| `http.ts` | GET con reintentos, retroceso exponencial con jitter y respeto de `Retry-After` |
| `fechas.ts` | Día de negociación desde la zona horaria de la bolsa, aritmética ISO |
| `yahoo.ts` | `YahooProvider` sobre el continuo `CC=F` (respaldo gratuito) |
| `barchart.ts` | `BarchartProvider` para la API OnDemand (listo, a la espera de la key) |
| `csv.ts` | Importación de históricos descargados de barchart.com |
| `trm.ts` | TRM oficial desde el dataset Socrata `32sa-8pi3` de datos.gov.co |
| `cache.ts` | Lectura, upsert y degradación elegante sobre la tabla `precios` |
| `mercado.ts` | Orquestador: arma el objeto `Mercado` que consume el motor |

### Qué se reintenta y qué no

Solo lo que puede mejorar al insistir: errores de red, tiempos agotados, 429 y
5xx. Un 401 o un 404 fallan de inmediato — insistir con una credencial mala no
la arregla. Ante un 429 se respeta el `Retry-After` que envíe el servidor antes
que cualquier heurística propia.

### El límite de peticiones de Yahoo es real

Medido, no supuesto: alrededor de una decena de consultas seguidas bastaron
para que Yahoo empezara a devolver 429 por IP, y a partir de ahí rechazó
**incluso los rangos cortos durante más de 30 minutos** (sondeado cada 60-90 s
hasta agotar 35 minutos). No es un fallo del cliente; es la política de la
fuente gratuita. Por eso:

- El `YahooProvider` reintenta con esperas largas (4 s de base, 4 intentos), no
  con las del cliente HTTP genérico: un reintento a 500 ms cae dentro de la
  misma ventana sancionada y solo gasta cuota.
- **La defensa de verdad es la caché.** Una vez sembrada la serie, el refresco
  diario es marginal y un rechazo puntual deja de tumbar el análisis:
  `obtenerSerieConCache` devuelve lo cacheado antes que propagar el error,
  porque un dato de ayer vale más que una pantalla de error.
- El respaldo manual es la importación de CSV, que es justamente lo que sí
  permite una cuenta estándar de barchart.com.

Se evaluó Stooq como segunda fuente gratuita y se descartó: exige resolver un
reto JavaScript de prueba de trabajo, inviable desde el servidor.

### Decisiones de la capa de datos

**La TRM tiene vigencias multi-día.** Un registro puede cubrir de viernes a
lunes. Se conserva una observación por `vigenciadesde`, que equivale a la serie
de días hábiles y es lo correcto para anualizar con base 252. Expandir el valor
sobre los fines de semana metería retornos cero artificiales y **subestimaría**
el riesgo cambiario.

**El día de negociación se deriva del huso de la bolsa.** Yahoo entrega la
medianoche local de la bolsa como instante UTC; leer el timestamp crudo
funcionaría por casualidad en Nueva York y fallaría en cualquier bolsa con
desplazamiento positivo.

**El CSV detecta su separador y su formato de fecha.** Barchart exporta con
coma y fechas mm/dd/aaaa, pero Excel en configuración regional colombiana
reescribe el archivo con punto y coma, coma decimal y fechas dd/mm/aaaa. Como
`11/09/2026` es ambiguo y leerlo mal corrompe la serie en silencio, el
separador se usa como indicio del formato de fecha.

**Barchart responde 200 aunque falle.** El código real viene en `status.code`
dentro del cuerpo, así que se valida siempre el sobre, nunca solo el HTTP.

### Estado verificado de las fuentes

| Fuente | Estado |
|---|---|
| TRM (datos.gov.co) | ✅ En vivo: 235 observaciones en un año, volatilidad anualizada 12,43 %. Serie sembrada en la caché |
| Yahoo `CC=F` | ⚠️ Parser validado contra respuesta real capturada; la llamada en vivo quedó sin confirmar por un bloqueo 429 de más de una hora |
| Barchart OnDemand | ⏸ Implementado; requiere `BARCHART_API_KEY` (producto aparte) |
| CSV de Barchart | ✅ Parser probado con export real, incluido pie de página y celdas `N/A` |
| Caché en `precios` | ✅ Ciclo completo verificado con el código de producción contra el Postgres real: escritura, relectura, idempotencia del upsert y RLS bloqueando a `anon` |

---

## Cobertura de tests

326 tests. La cobertura no es uniforme a propósito:

| Área | Sentencias | Por qué |
|---|---:|---|
| `lib/engine` | 98 % | Es donde vive el dinero. Cálculo puro, todo testeable |
| `lib/data` | 95 % | Parsers, reintentos y caché, con fixtures de respuestas reales |
| `lib/anthropic` | 82 % | El resumen, la verificación de cifras y los errores; la llamada real se probó contra la API |
| `lib/acciones` | 22 % | Orquestación fina sobre piezas ya testeadas. Verificadas de extremo a extremo en el navegador, no con mocks frágiles |

Los tests que dependen de los históricos de barchart.com se saltan solos si los
archivos no están (`describe.skipIf`), para que un clon limpio no falle.

---

## Arquitectura

```
src/
├─ app/
│  ├─ (auth)/login/       Acceso por correo y contraseña (server actions)
│  ├─ (app)/              Rutas privadas: layout con navegación + dashboard
│  ├─ auth/callback/      Canje del código de confirmación por sesión
│  └─ api/                Route handlers (fases 3-5)
├─ components/            UI compartida (incluye el disclaimer obligatorio)
├─ lib/
│  ├─ engine/             ★ Motor de cálculo: TypeScript puro, sin I/O, testeado
│  ├─ data/               PriceProvider: Yahoo, Barchart, TRM, caché (fase 3)
│  ├─ anthropic/          Informe narrativo, solo servidor (fase 5)
│  ├─ supabase/           Clientes: navegador, servidor, admin, proxy de sesión
│  └─ env.ts              Validación de variables de entorno
├─ types/database.ts      Tipos del schema
└─ proxy.ts               Refresco de sesión y protección de rutas
```

**Regla de oro del informe narrativo:** todas las cifras las calcula
`src/lib/engine`. El LLM únicamente interpreta el JSON de resultados, redacta y
señala riesgos cualitativos (clima en África Occidental, logística, contraparte).
El prompt de sistema le prohíbe expresamente inventar números.

### Variables de entorno: validación granular

Cada secreto se valida por separado y solo cuando se va a usar
(`claveServiceRole()`, `envAnthropic()`, `envDatosMercado()`). Validarlos en
bloque hacía que `/api/precios` devolviera 500 por faltar la clave de
Anthropic, que esa ruta no usa, y anulaba la degradación prevista cuando no
hay service role key.

### Las rutas de API responden 401, no redirigen

El proxy protege las páginas redirigiendo a `/login`, pero para `/api/*`
devuelve `401` en JSON: un `fetch` seguiría la redirección, recibiría el HTML
del login y fallaría al parsearlo como JSON con un error que no dice nada.

### Separación de clientes de Supabase

- `crearClienteNavegador()` — componentes de cliente, anon key.
- `crearClienteServidor()` — server components, actions y route handlers. **Respeta RLS.**
- `crearClienteAdmin()` — `service_role`, **salta RLS**. Uso exclusivo para la
  caché compartida de `precios`; nunca para datos de un usuario.

La sesión se valida siempre con `getUser()` (verifica el JWT contra el servidor
de Auth), no con `getSession()`, cuyo contenido sale de la cookie.
