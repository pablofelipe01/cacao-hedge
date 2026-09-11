import { FormularioAcceso } from "./FormularioAcceso";
import { Disclaimer } from "@/components/Disclaimer";

export default async function PaginaLogin({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const redirigir =
    typeof params.redirigir === "string" && params.redirigir.startsWith("/")
      ? params.redirigir
      : "/dashboard";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-cacao">
            CacaoHedge
          </h1>
          <p className="text-sm text-texto-suave">
            Apoyo a decisiones de cobertura para exportadores de cacao.
          </p>
        </header>

        <FormularioAcceso redirigir={redirigir} />
        <Disclaimer />
      </div>
    </main>
  );
}
