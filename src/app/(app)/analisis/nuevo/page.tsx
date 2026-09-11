import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { crearClienteServidor } from "@/lib/supabase/server";
import { seriesDisponibles } from "@/lib/data/cache";
import { FormularioAnalisis } from "./FormularioAnalisis";

export default async function PaginaNuevoAnalisis({
  searchParams,
}: PageProps<"/analisis/nuevo">) {
  const params = await searchParams;
  const loteId = typeof params.lote === "string" ? params.lote : null;

  const supabase = await crearClienteServidor();

  // Lotes activos para el desplegable, y el preseleccionado si viene por URL.
  const [{ data: lotes }, series] = await Promise.all([
    supabase
      .from("inventarios")
      .select(
        "id, nombre, toneladas, costo_cop_kg, fecha_embarque, diferencial_usd_tm, tipo_contrato, precio_venta_usd_tm",
      )
      .eq("activo", true)
      .order("fecha_embarque", { ascending: true }),
    seriesDisponibles(supabase, "CC"),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Nuevo análisis</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="text-sm text-texto-suave">
          El sistema trae el futuro CC y la TRM del día, calcula las nueve estrategias y
          recomienda una. Tarda unos segundos.
        </p>
      </header>

      <FormularioAnalisis lotes={lotes ?? []} loteInicial={loteId} series={series} />
      <Disclaimer />
    </div>
  );
}
