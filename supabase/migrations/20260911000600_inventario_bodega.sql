-- =====================================================================
-- CacaoHedge — Espejo del inventario real de bodega
--
-- Refleja las filas con saldo de la hoja de cálculo operativa. Es un
-- espejo, no la fuente: la hoja manda, y cada sincronización reemplaza
-- lo que había. Por eso se guarda el número de fila y el momento de
-- sincronización, para poder rastrear cualquier cifra hasta su origen.
--
-- No sustituye a `inventarios`: la hoja sabe cuánto cacao hay, pero no
-- la fecha de embarque ni el diferencial pactado, que son decisiones
-- comerciales y las pone el usuario.
-- =====================================================================

create table public.inventario_bodega (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  -- Identificador de la hoja de origen: permite tener varias.
  hoja_id                 text not null,
  -- Fila en la hoja (1-indexada), para rastrear la cifra hasta su origen.
  fila                    int not null check (fila > 0),
  fecha_ingreso           date,
  codigo_procedencia      text not null,
  -- Valor de compra declarado en la hoja, COP/kg. Puede faltar.
  valor_compra_cop_kg     numeric(14,2) check (valor_compra_cop_kg is null or valor_compra_cop_kg >= 0),
  cantidad_ingresada_kg   numeric(14,2),
  cantidad_salida_kg      numeric(14,2),
  -- Columna O de la hoja: lo que de verdad queda en bodega.
  cantidad_disponible_kg  numeric(14,2) not null check (cantidad_disponible_kg >= 0),
  sincronizado_en         timestamptz not null default now(),
  constraint uq_bodega_fila unique (user_id, hoja_id, fila)
);

comment on table public.inventario_bodega is
  'Espejo de las filas con saldo de la hoja operativa de inventario.';
comment on column public.inventario_bodega.cantidad_disponible_kg is
  'Columna O de la hoja: CANTIDAD DISPONIBLE EN BODEGA, en kilogramos.';

create index idx_bodega_user on public.inventario_bodega (user_id, sincronizado_en desc);

alter table public.inventario_bodega enable row level security;

create policy "bodega_select_propio" on public.inventario_bodega
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "bodega_insert_propio" on public.inventario_bodega
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "bodega_update_propio" on public.inventario_bodega
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "bodega_delete_propio" on public.inventario_bodega
  for delete to authenticated
  using (user_id = (select auth.uid()));
