# PROMPT BASE PARA CLAUDE CODE — Proyecto "CacaoHedge"

Copia todo lo que sigue y pégalo como primer mensaje en Claude Code.

---

## Contexto del negocio

Soy un exportador de cacao en Colombia. Quiero construir una aplicación de apoyo a decisiones de cobertura (hedging) para mi inventario físico. El flujo central es:

> Yo ingreso: "Tengo X toneladas de cacao en bodega en [ciudad], listas para exportar, con costo de adquisición de Y COP/kg, embarque estimado en la fecha Z, y mi contrato de venta es [precio fijo en USD | precio por fijar contra futuros NY | aún sin contrato]".
>
> La aplicación me devuelve: análisis de cobertura con futuros y opciones de cacao (ICE, símbolo CC), escenarios de precio, niveles de riesgo, exposición cambiaria COP/USD, y un informe narrativo en español generado con la API de Anthropic.

## Conceptos de dominio que DEBES implementar correctamente

1. **Contrato de referencia**: Cacao ICE Futures US (NY), símbolo CC. Tamaño: 10 toneladas métricas por contrato. Cotiza en USD por tonelada métrica. Tick mínimo: $1/TM = $10 por contrato. Vencimientos: marzo (H), mayo (K), julio (N), septiembre (U), diciembre (Z).
2. **Cobertura corta (short hedge)**: quien tiene inventario físico se cubre VENDIENDO futuros. Número de contratos = toneladas / 10, redondeado hacia abajo (subcobertura) o hacia arriba (sobrecobertura) — mostrar ambas alternativas con su exposición residual.
3. **Riesgo de base (basis risk)**: el cacao colombiano (fino de aroma) se vende con un diferencial (prima o descuento) sobre el futuro NY. El precio efectivo = futuro ± diferencial. La cobertura con futuros NO elimina el riesgo del diferencial. Pedir al usuario su diferencial estimado en USD/TM y modelar escenarios donde la base se mueve independientemente del futuro.
4. **Riesgo cambiario**: los ingresos son en USD pero los costos en COP. Integrar la TRM oficial (API pública gratuita de datos.gov.co, dataset "TRM" — endpoint Socrata `https://www.datos.gov.co/resource/32sa-8pi3.json`) y modelar escenarios de revaluación/devaluación del peso.
5. **Estrategias a evaluar y comparar** (con payoff, costo, escenarios de resultado neto):
   - Sin cobertura (base case)
   - Venta de futuros (cobertura 50%, 75%, 100%)
   - Compra de puts (protective put) a distintos strikes
   - Collar (compra put + venta call)
   - Fijación escalonada (vender en tramos)
6. **Métricas de riesgo**: exposición nominal en USD y COP, resultado neto por escenario, peor caso / mejor caso, VaR paramétrico 95% a horizonte del embarque usando volatilidad histórica anualizada calculada de la serie de precios, y estimación de llamadas de margen si el futuro sube estando corto (margen inicial y de mantenimiento configurables, con valores por defecto documentados).
7. **Escenarios**: matriz determinística (precio del futuro: -30%, -20%, -10%, 0, +10%, +20%, +30%; TRM: -10%, 0, +10%; base: -100, 0, +100 USD/TM) + simulación Monte Carlo simple (GBM con vol histórica, 10.000 trayectorias) para la distribución del ingreso neto en COP.

## Stack técnico

- **Frontend**: Next.js (App Router) + TypeScript + Tailwind. UI en español. Gráficos con Recharts (distribución Monte Carlo, payoffs de opciones, matriz de escenarios como heatmap).
- **Backend/DB**: Supabase — Auth (email), Postgres con tablas: `inventarios` (lotes: toneladas, costo COP/kg, ubicación, fecha embarque, diferencial), `precios` (caché de series OHLC diarias de CC y TRM), `analisis` (resultados y reportes generados, JSON), `configuracion` (márgenes, comisiones, supuestos por usuario). Row Level Security activado. Usar el MCP de Supabase si está disponible, si no, migraciones SQL en `/supabase/migrations`.
- **Datos de mercado**: capa de abstracción `PriceProvider` con dos implementaciones:
  1. `BarchartProvider`: tengo cuenta estándar de Barchart. IMPORTANTE: verifica primero si mi cuenta incluye acceso a la API OnDemand (getQuote/getHistory) — probablemente NO, porque la API es un producto separado. Implementa el cliente igualmente (endpoints `getQuote.json` y `getHistory.json` con apikey por variable de entorno) y déjalo listo para cuando tenga la key. Mientras tanto, soporta también importación manual de CSV descargado de barchart.com (mi cuenta estándar sí permite descargar históricos).
  2. `YahooProvider` (fallback gratuito): serie diaria del continuo `CC=F` para desarrollo y prototipado.
  El sistema debe funcionar completo con el fallback gratuito.
- **API de Anthropic**: usar el SDK oficial (`@anthropic-ai/sdk`) desde el servidor (route handler o Supabase Edge Function, NUNCA desde el cliente). Modelo configurable por env var. Uso: generar el informe ejecutivo narrativo en español a partir del JSON de resultados cuantitativos (los números los calcula el código, NO el LLM — el LLM solo interpreta, redacta y señala riesgos cualitativos como clima en África Occidental, logística, contraparte). Incluir prompt de sistema que le prohíba inventar cifras: solo puede usar las del JSON.
- **Variables de entorno**: `ANTHROPIC_API_KEY`, `BARCHART_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Crear `.env.example`.

## Flujo de la aplicación

1. Login → dashboard con lotes de inventario.
2. "Nuevo análisis": formulario (toneladas, costo COP/kg, fecha embarque, diferencial USD/TM, tipo de contrato de venta, % de cobertura deseado o "recomiéndame").
3. El backend: trae precio spot/futuros y TRM → calcula todas las estrategias, escenarios, VaR y Monte Carlo → guarda en `analisis` → llama a Anthropic para el informe narrativo.
4. Vista de resultados: tarjetas de métricas clave, tabla comparativa de estrategias, heatmap de escenarios, histograma Monte Carlo, payoff de opciones, informe narrativo, y botón para exportar PDF.
5. Historial de análisis por lote.

## Reglas de calidad

- Todo el motor de cálculo en módulos puros TypeScript (`/lib/engine/`) con tests unitarios (Vitest) — al menos: cálculo de contratos, payoff de put/collar, VaR, conversión COP/USD, matriz de escenarios.
- Disclaimer visible: la herramienta es de apoyo a decisiones y no constituye asesoría financiera.
- Manejo de errores de APIs externas con reintentos y mensajes claros.
- Código y comentarios en español donde sea razonable; commits en inglés convencional.

## Plan de trabajo (ejecutar por fases, validando conmigo al final de cada una)

1. **Fase 1**: scaffold Next.js + Supabase (schema + RLS + auth) + `.env.example`.
2. **Fase 2**: motor de cálculo puro con tests (sin UI): contratos, estrategias, escenarios, VaR, Monte Carlo.
3. **Fase 3**: capa de datos (YahooProvider funcional, BarchartProvider preparado, TRM de datos.gov.co, caché en Supabase).
4. **Fase 4**: UI del formulario y resultados con gráficos.
5. **Fase 5**: integración Anthropic para el informe narrativo + exportación PDF.
6. **Fase 6**: historial, configuración de supuestos, pulido.

Empieza por la Fase 1. Antes de escribir código, muéstrame el schema SQL propuesto y la estructura de carpetas para aprobarlos.
