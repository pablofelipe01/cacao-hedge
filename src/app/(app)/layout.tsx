import Link from "next/link";

import { cerrarSesion } from "@/app/(auth)/login/acciones";
import { obtenerUsuario } from "@/lib/supabase/server";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const usuario = await obtenerUsuario();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-borde bg-superficie">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/dashboard" className="font-semibold tracking-tight text-cacao">
            CacaoHedge
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-texto-suave hover:text-texto">
              Inventario
            </Link>
            <Link href="/importar" className="text-texto-suave hover:text-texto">
              Importar
            </Link>
            <Link href="/configuracion" className="text-texto-suave hover:text-texto">
              Supuestos
            </Link>
            <span className="hidden text-texto-suave sm:inline">{usuario?.email}</span>
            <form action={cerrarSesion}>
              <button
                type="submit"
                className="rounded-md border border-borde px-2.5 py-1 text-texto-suave transition hover:text-texto"
              >
                Salir
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
