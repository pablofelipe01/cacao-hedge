-- =====================================================================
-- CacaoHedge — Triggers
--  1. Mantener updated_at al dia.
--  2. Crear la fila de `configuracion` con defaults al registrarse un
--     usuario nuevo, para que la app nunca opere sin supuestos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. updated_at automatico
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_inventarios_updated_at
  before update on public.inventarios
  for each row execute function public.tg_set_updated_at();

create trigger trg_configuracion_updated_at
  before update on public.configuracion
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- 2. Alta de configuracion por defecto para cada usuario nuevo
--    SECURITY DEFINER porque corre en el contexto de auth.users.
-- ---------------------------------------------------------------------
create or replace function public.tg_crear_configuracion_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.configuracion (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger trg_auth_user_configuracion
  after insert on auth.users
  for each row execute function public.tg_crear_configuracion_usuario();
