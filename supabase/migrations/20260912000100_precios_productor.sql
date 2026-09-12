-- =====================================================================
-- CacaoHedge — Precios de compra publicados por Nacional y Luker
--
-- Compañía Nacional de Chocolates y Casa Luker fijan el precio en pesos
-- del cacao colombiano. No es un mercado: es un precio administrado que
-- el exportador tiene que igualar para conseguir grano.
--
-- Esto importa porque el diferencial contra Nueva York —el dato que más
-- mueve un análisis de cobertura— no es una fórmula pactada sino una
-- relación observada entre ese precio y la bolsa. Antes se le pedía al
-- usuario de memoria; con esta tabla se mide.
--
-- Espejo de la hoja, igual que `inventario_bodega`: la hoja manda y cada
-- sincronización reemplaza lo que había para ese día y comprador.
-- =====================================================================

create table public.precios_productor (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- Identificador de la hoja de origen: permite tener varias.
  hoja_id        text not null,
  fecha          date not null,
  -- Comprador y calidad: el bajo cadmio se paga por encima del alto.
  comprador      text not null check (comprador in (
                   'luker_bajo_cadmio',
                   'luker_alto_cadmio',
                   'nacional_bogota',
                   'nacional_ibague'
                 )),
  precio_cop_kg  numeric(12,2) not null check (precio_cop_kg > 0),
  sincronizado_en timestamptz not null default now(),
  -- Un precio por comprador y día: reimportar corrige, no duplica.
  constraint uq_precio_productor unique (user_id, hoja_id, fecha, comprador)
);

comment on table public.precios_productor is
  'Precios de compra publicados por Nacional de Chocolates y Casa Luker, en COP/kg.';
comment on column public.precios_productor.comprador is
  'Comprador y calidad. El bajo cadmio se paga por encima del alto.';

create index idx_precios_productor_user
  on public.precios_productor (user_id, comprador, fecha desc);

alter table public.precios_productor enable row level security;

create policy "precios_productor_select_propio" on public.precios_productor
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "precios_productor_insert_propio" on public.precios_productor
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "precios_productor_update_propio" on public.precios_productor
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "precios_productor_delete_propio" on public.precios_productor
  for delete to authenticated
  using (user_id = (select auth.uid()));
