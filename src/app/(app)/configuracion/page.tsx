import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { SUPUESTOS_POR_DEFECTO } from "@/lib/engine/tipos";
import { FormularioConfiguracion } from "./FormularioConfiguracion";

export default async function PaginaConfiguracion() {
  const usuario = await obtenerUsuario();
  const supabase = await crearClienteServidor();

  const { data } = await supabase
    .from("configuracion")
    .select("*")
    .eq("user_id", usuario?.id ?? "")
    .maybeSingle();

  const valores = {
    margenInicialUsd: Number(data?.margen_inicial_usd ?? SUPUESTOS_POR_DEFECTO.margenInicialUsd),
    margenMantenimientoUsd: Number(
      data?.margen_mantenimiento_usd ?? SUPUESTOS_POR_DEFECTO.margenMantenimientoUsd,
    ),
    comisionUsdContrato: Number(
      data?.comision_usd_contrato ?? SUPUESTOS_POR_DEFECTO.comisionUsdContrato,
    ),
    tasaLibreRiesgoPorcentaje:
      Number(data?.tasa_libre_riesgo ?? SUPUESTOS_POR_DEFECTO.tasaLibreRiesgo) * 100,
    volFallbackPorcentaje: Number(data?.vol_fallback ?? 0.35) * 100,
    diasHabilesAnio: data?.dias_habiles_anio ?? SUPUESTOS_POR_DEFECTO.diasHabilesAnio,
    nivelConfianzaVarPorcentaje:
      Number(data?.nivel_confianza_var ?? SUPUESTOS_POR_DEFECTO.nivelConfianzaVar) * 100,
    trayectoriasMc: data?.trayectorias_mc ?? SUPUESTOS_POR_DEFECTO.trayectoriasMc,
  };

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Supuestos de cálculo</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-texto-suave">
          Estos valores alimentan el motor. Cambiarlos <strong>no altera los análisis
          ya hechos</strong>: cada uno guardó los supuestos con que se corrió, y por eso
          se puede volver a abrir meses después y que las cifras sigan cuadrando.
        </p>
      </header>

      <FormularioConfiguracion valores={valores} />
      <Disclaimer />
    </div>
  );
}
