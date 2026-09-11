-- =====================================================================
-- CacaoHedge — Resumen de series en caché
--
-- Agregar en el cliente obligaba a descargar todas las filas, y PostgREST
-- corta la respuesta en 1.000: con la caché ya cargada los conteos salían
-- truncados y alguna serie podía desaparecer del selector. La agregación
-- va donde corresponde, en la base.
--
-- security_invoker hace que la vista respete el RLS de `precios` con los
-- permisos de quien consulta, no los del dueño de la vista.
-- =====================================================================

create view public.series_precios
with (security_invoker = true) as
select
  serie,
  simbolo,
  fuente,
  count(*)::int as barras,
  min(fecha)    as primera,
  max(fecha)    as ultima
from public.precios
group by serie, simbolo, fuente;

comment on view public.series_precios is
  'Una fila por serie cacheada (serie, simbolo, fuente) con su conteo y rango de fechas.';
