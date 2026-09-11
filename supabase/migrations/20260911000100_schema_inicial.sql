-- =====================================================================
-- CacaoHedge — Schema inicial
-- Dominio: cobertura (hedging) de inventario fisico de cacao para
-- exportacion. Contrato de referencia: ICE Futures US "CC" (Nueva York),
-- 10 toneladas metricas por contrato, cotizado en USD/TM.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos enumerados del dominio
-- ---------------------------------------------------------------------

-- Como esta pactada la venta del lote fisico
create type public.tipo_contrato_venta as enum (
  'precio_fijo_usd',  -- precio cerrado en USD/TM
  'por_fijar_ny',     -- price-to-be-fixed contra futuro NY + diferencial
  'sin_contrato'      -- inventario aun sin comprador
);

-- Serie de precios cacheada
create type public.tipo_serie as enum ('CC', 'TRM');

-- Origen del dato de precio
create type public.fuente_precio as enum (
  'yahoo',          -- continuo CC=F (fallback gratuito)
  'barchart_api',   -- OnDemand getQuote/getHistory
  'barchart_csv',   -- CSV descargado manualmente de barchart.com
  'datos_gov_co',   -- TRM oficial (Socrata 32sa-8pi3)
  'manual'          -- captura manual del usuario
);

-- Ciclo de vida de un analisis
create type public.estado_analisis as enum (
  'pendiente',    -- creado, calculo en curso
  'calculado',    -- motor cuantitativo termino
  'con_informe',  -- ademas tiene narrativa generada por el LLM
  'error'
);

-- ---------------------------------------------------------------------
-- inventarios: lotes de cacao fisico en bodega
-- ---------------------------------------------------------------------
create table public.inventarios (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  nombre              text not null check (length(btrim(nombre)) > 0),
  toneladas           numeric(12,3) not null check (toneladas > 0),
  costo_cop_kg        numeric(14,2) not null check (costo_cop_kg >= 0),
  ubicacion           text not null check (length(btrim(ubicacion)) > 0),
  fecha_embarque      date not null,
  -- Diferencial (base) del cacao colombiano fino de aroma frente al
  -- futuro NY. Positivo = prima, negativo = descuento. En USD/TM.
  diferencial_usd_tm  numeric(10,2) not null default 0,
  tipo_contrato       public.tipo_contrato_venta not null default 'sin_contrato',
  -- Solo aplica cuando el contrato es a precio fijo
  precio_venta_usd_tm numeric(12,2) check (precio_venta_usd_tm is null or precio_venta_usd_tm > 0),
  -- Mes de vencimiento del futuro de referencia: H,K,N,U,Z + anio (ej. 'Z26')
  mes_futuro          text check (mes_futuro is null or mes_futuro ~ '^[HKNUZ][0-9]{2}$'),
  notas               text,
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_precio_fijo check (
    tipo_contrato <> 'precio_fijo_usd' or precio_venta_usd_tm is not null
  )
);

comment on table  public.inventarios is 'Lotes de cacao fisico sujetos a cobertura.';
comment on column public.inventarios.diferencial_usd_tm is 'Base vs futuro NY en USD/TM. Positivo = prima, negativo = descuento.';

create index idx_inventarios_user       on public.inventarios (user_id, activo, fecha_embarque);
create index idx_inventarios_user_fecha on public.inventarios (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- precios: cache compartida de series diarias (CC y TRM)
-- Escrita solo por el backend (service_role); legible por autenticados.
-- ---------------------------------------------------------------------
create table public.precios (
  id         bigint generated always as identity primary key,
  serie      public.tipo_serie not null,
  simbolo    text not null,   -- 'CC=F', 'CCZ26', 'USDCOP'
  fecha      date not null,
  apertura   numeric(14,4),
  maximo     numeric(14,4),
  minimo     numeric(14,4),
  cierre     numeric(14,4) not null,
  volumen    bigint,
  fuente     public.fuente_precio not null,
  created_at timestamptz not null default now(),
  constraint uq_precios_simbolo_fecha_fuente unique (simbolo, fecha, fuente)
);

comment on table public.precios is 'Cache OHLC diaria de CC (USD/TM) y TRM (COP/USD).';

create index idx_precios_serie_fecha on public.precios (serie, simbolo, fecha desc);

-- ---------------------------------------------------------------------
-- analisis: snapshot reproducible de cada corrida de cobertura
-- ---------------------------------------------------------------------
create table public.analisis (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  inventario_id uuid references public.inventarios (id) on delete set null,
  estado        public.estado_analisis not null default 'pendiente',
  -- Copia literal del formulario que origino el analisis
  entradas      jsonb not null,
  -- Datos de mercado usados: {futuro_usd_tm, trm, vol_anualizada, fecha_datos, fuente}
  mercado       jsonb not null,
  -- Copia de public.configuracion al momento del calculo
  supuestos     jsonb not null,
  -- Salida del motor: estrategias, escenarios, VaR, Monte Carlo, margenes
  resultados    jsonb,
  -- Informe ejecutivo narrativo en espanol (Markdown) generado con Anthropic
  informe_md    text,
  informe_meta  jsonb,
  error         text,
  created_at    timestamptz not null default now()
);

comment on table public.analisis is 'Resultados cuantitativos + informe narrativo por corrida.';

create index idx_analisis_user       on public.analisis (user_id, created_at desc);
create index idx_analisis_inventario on public.analisis (inventario_id, created_at desc);

-- ---------------------------------------------------------------------
-- configuracion: supuestos de calculo por usuario (1 fila por usuario)
--
-- Defaults de margen: ICE ajusta el margen del CC con frecuencia (en 2024
-- supero los USD 20.000/contrato). Los valores de abajo son un punto de
-- partida razonable y DEBEN confirmarse con el broker.
-- ---------------------------------------------------------------------
create table public.configuracion (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  margen_inicial_usd       numeric(12,2) not null default 8000   check (margen_inicial_usd > 0),
  margen_mantenimiento_usd numeric(12,2) not null default 7200   check (margen_mantenimiento_usd > 0),
  comision_usd_contrato    numeric(10,2) not null default 15     check (comision_usd_contrato >= 0),
  tasa_libre_riesgo        numeric(6,4)  not null default 0.0425,
  vol_fallback             numeric(6,4)  not null default 0.3500 check (vol_fallback > 0),
  dias_habiles_anio        int           not null default 252    check (dias_habiles_anio between 200 and 366),
  nivel_confianza_var      numeric(5,4)  not null default 0.9500 check (nivel_confianza_var > 0.5 and nivel_confianza_var < 1),
  trayectorias_mc          int           not null default 10000  check (trayectorias_mc between 1000 and 200000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint chk_margenes check (margen_mantenimiento_usd <= margen_inicial_usd)
);

comment on table public.configuracion is 'Supuestos de calculo por usuario (margenes, comisiones, VaR, Monte Carlo).';
