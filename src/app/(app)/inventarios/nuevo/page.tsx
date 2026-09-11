import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { FormularioLote } from "./FormularioLote";

export default function PaginaNuevoLote() {
  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Nuevo lote</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="text-sm text-texto-suave">
          Registre el cacao en bodega. Al guardarlo se abre el análisis de cobertura con
          los datos ya cargados.
        </p>
      </header>

      <FormularioLote />
      <Disclaimer />
    </div>
  );
}
