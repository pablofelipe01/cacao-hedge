-- =====================================================================
-- CacaoHedge — Endurecimiento de permisos
-- Las funciones de trigger viven en el schema `public`, que PostgREST
-- expone como API. Sin este revoke, cualquiera podria invocarlas por
-- /rest/v1/rpc/. Solo el motor de triggers necesita ejecutarlas.
-- =====================================================================

revoke execute on function public.tg_crear_configuracion_usuario() from public, anon, authenticated;
revoke execute on function public.tg_set_updated_at()             from public, anon, authenticated;
