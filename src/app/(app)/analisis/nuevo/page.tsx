import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { crearClienteServidor } from "@/lib/supabase/server";
import { seriesDisponibles } from "@/lib/data/cache";
import { FormularioAnalisis } from "./FormularioAnalisis";

/**
 * Estas páginas lanzan acciones que salen a la red —datos de mercado, TRM,
 * la hoja de cálculo— y el arranque en frío puede superar el límite por
 * defecto de 10 segundos.
 */
export const maxDuration = 30;

export default async function PaginaNuevoAnalisis({
  searchParams,
}: PageProps<"/analisis/nuevo">) {
  const params = await searchParams;
  const loteId = typeof params.lote === "string" ? params.lote : null;

  const supabase = await crearClienteServidor();

  const [{ data: lotes }, series, { data: bodega }] = await Promise.all([
    supabase
      .from("inventarios")
      .select(
        "id, nombre, toneladas, costo_cop_kg, fecha_embarque, diferencial_usd_tm, tipo_contrato, precio_venta_usd_tm",
      )
      .eq("activo", true)
      .order("fecha_embarque", { ascending: true }),
    seriesDisponibles(supabase, "CC"),
    supabase
      .from("inventario_bodega")
      .select("cantidad_disponible_kg, valor_compra_cop_kg"),
  ]);

  // Lo que de verdad hay en bodega, según la hoja operativa.
  const filasBodega = bodega ?? [];
  const bodegaKg = filasBodega.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);

  // El costo se pondera solo sobre los kilos que declaran precio: promediar
  // los que no lo traen inventaría un costo que nadie pagó.
  const conCosto = filasBodega.filter((f) => f.valor_compra_cop_kg != null);
  const kgConCosto = conCosto.reduce((a, f) => a + Number(f.cantidad_disponible_kg), 0);
  const costoPonderado =
    kgConCosto > 0
      ? conCosto.reduce(
          (a, f) => a + Number(f.valor_compra_cop_kg) * Number(f.cantidad_disponible_kg),
          0,
        ) / kgConCosto
      : null;

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Nuevo análisis</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-texto-suave">
          La cobertura no busca ganar dinero en la bolsa: busca que el precio deje de
          importar. Aquí se calcula cuánto de ese riesgo se puede quitar y qué cuesta
          quitarlo.{" "}
          <Link href="/guia" className="text-cacao hover:underline">
            Cómo leer los resultados
          </Link>
          .
        </p>
      </header>

      <FormularioAnalisis
        lotes={lotes ?? []}
        loteInicial={loteId}
        series={series}
        bodega={{
          lotes: filasBodega.length,
          toneladas: bodegaKg / 1000,
          costoCopKg: costoPonderado,
          kgConCostoPorcentaje: bodegaKg > 0 ? kgConCosto / bodegaKg : 0,
        }}
        desdeUrl={{
          toneladas: typeof params.toneladas === "string" ? params.toneladas : null,
          costoCopKg: typeof params.costo === "string" ? params.costo : null,
        }}
      />

      <Disclaimer />
    </div>
  );
}
