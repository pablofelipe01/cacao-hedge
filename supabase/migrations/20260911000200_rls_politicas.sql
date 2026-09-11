-- =====================================================================
-- CacaoHedge — Row Level Security
-- Cada usuario solo ve y modifica sus propios lotes, analisis y config.
-- La tabla `precios` es cache compartida: lectura para autenticados,
-- escritura exclusiva del backend (service_role, que ignora RLS).
-- Se usa (select auth.uid()) en vez de auth.uid() para que Postgres
-- evalue la funcion una sola vez por consulta (initPlan).
-- =====================================================================

alter table public.inventarios   enable row level security;
alter table public.precios       enable row level security;
alter table public.analisis      enable row level security;
alter table public.configuracion enable row level security;

-- ---------------------------------------------------------------------
-- inventarios
-- ---------------------------------------------------------------------
create policy "inventarios_select_propios" on public.inventarios
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "inventarios_insert_propios" on public.inventarios
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "inventarios_update_propios" on public.inventarios
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "inventarios_delete_propios" on public.inventarios
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- analisis
-- ---------------------------------------------------------------------
create policy "analisis_select_propios" on public.analisis
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "analisis_insert_propios" on public.analisis
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "analisis_update_propios" on public.analisis
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "analisis_delete_propios" on public.analisis
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- configuracion
-- ---------------------------------------------------------------------
create policy "configuracion_select_propia" on public.configuracion
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "configuracion_insert_propia" on public.configuracion
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "configuracion_update_propia" on public.configuracion
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- precios (cache compartida)
-- Sin policies de insert/update/delete: solo service_role puede escribir.
-- ---------------------------------------------------------------------
create policy "precios_select_autenticados" on public.precios
  for select to authenticated
  using (true);
