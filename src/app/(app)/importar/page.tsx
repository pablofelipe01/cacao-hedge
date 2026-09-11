import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { crearClienteServidor } from "@/lib/supabase/server";
import { seriesDisponibles } from "@/lib/data/cache";
import { fechaLegible } from "@/lib/formato";
import { FormularioImportacion } from "./FormularioImportacion";

export default async function PaginaImportar() {
  const supabase = await crearClienteServidor();

  // Qué hay hoy en la caché, para que el usuario sepa si le falta algo.
  // La agregación la hace Postgres: contar aquí obligaría a paginar.
  const [cacao, trm] = await Promise.all([
    seriesDisponibles(supabase, "CC"),
    seriesDisponibles(supabase, "TRM"),
  ]);
  const resumen = [...cacao, ...trm];

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Importar histórico</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-texto-suave">
          Una cuenta estándar de barchart.com permite descargar históricos desde la web
          aunque no incluya la API. Súbalos aquí y quedan en la caché: el análisis deja de
          depender del límite de peticiones de Yahoo.
        </p>
      </header>

      <FormularioImportacion />

      <section aria-labelledby="cache" className="space-y-2">
        <h2 id="cache" className="text-sm font-semibold">Series en caché</h2>
        {resumen.length === 0 ? (
          <p className="text-sm text-texto-suave">La caché está vacía.</p>
        ) : (
          <ul className="divide-y divide-borde rounded-lg border border-borde bg-superficie text-sm">
            {resumen.map((dato) => (
              <li
                key={`${dato.simbolo}|${dato.fuente}`}
                className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5"
              >
                <span className="font-medium">
                  {dato.simbolo}
                  <span className="ml-2 text-xs font-normal text-texto-suave">{dato.fuente}</span>
                </span>
                <span className="tabular text-texto-suave">
                  {dato.barras} barras · {fechaLegible(dato.primera)} → {fechaLegible(dato.ultima)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Disclaimer />
    </div>
  );
}
