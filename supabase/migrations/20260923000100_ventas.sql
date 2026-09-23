-- =====================================================================
-- CacaoHedge — Ventas comprometidas
--
-- Las ventas cerradas no viven en ninguna hoja del exportador: se
-- registran aquí. Junto con el inventario de bodega forman la posición
-- de la empresa, que se analiza mes a mes en /posicion.
--
-- Dos modalidades, las dos habituales en el negocio:
--   - precio_pactado: el precio en USD/TM ya está cerrado.
--   - por_fijar:      se vende contra Nueva York ± un diferencial, y el
--                     precio se fija más adelante, normalmente al
--                     embarcar. El diferencial se pacta en % del futuro o
--                     en USD/TM: las dos formas son comunes.
-- =====================================================================

create type public.modalidad_venta as enum ('precio_pactado', 'por_fijar');
create type public.unidad_diferencial as enum ('usd_tm', 'porcentaje');

create table public.ventas (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  comprador           text not null check (length(btrim(comprador)) > 0),
  toneladas           numeric(12,3) not null check (toneladas > 0),
  fecha_embarque      date not null,
  modalidad           public.modalidad_venta not null,
  -- Solo con precio pactado.
  precio_usd_tm       numeric(12,2) check (precio_usd_tm is null or precio_usd_tm > 0),
  -- Solo por fijar. En porcentaje se guarda como se escribe: −5 = 5 %
  -- por debajo de Nueva York.
  diferencial         numeric(12,3),
  unidad_diferencial  public.unidad_diferencial,
  notas               text,
  -- Baja lógica: una venta embarcada o cancelada deja de contar en la
  -- posición, pero no se borra.
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_venta_precio check (
    modalidad <> 'precio_pactado' or precio_usd_tm is not null
  ),
  constraint chk_venta_diferencial check (
    modalidad <> 'por_fijar' or (diferencial is not null and unidad_diferencial is not null)
  ),
  constraint chk_venta_porcentaje check (
    unidad_diferencial is distinct from 'porcentaje' or abs(diferencial) < 100
  )
);

comment on table public.ventas is
  'Ventas cerradas pendientes de embarque: precio pactado o por fijar contra NY.';

create index idx_ventas_user on public.ventas (user_id, activo, fecha_embarque);

create trigger trg_ventas_updated_at
  before update on public.ventas
  for each row execute function public.tg_set_updated_at();

alter table public.ventas enable row level security;

create policy "ventas_select_propio" on public.ventas
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "ventas_insert_propio" on public.ventas
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "ventas_update_propio" on public.ventas
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "ventas_delete_propio" on public.ventas
  for delete to authenticated
  using (user_id = (select auth.uid()));
