import Link from "next/link";

export default function NoEncontrado() {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">No encontramos eso</h1>
      <p className="text-sm leading-relaxed text-texto-suave">
        El lote o el análisis no existe, o pertenece a otra cuenta. Los datos de cada
        usuario están aislados en la base, así que un enlace ajeno nunca abre nada.
      </p>
      <Link
        href="/dashboard"
        className="inline-block rounded-md bg-cacao px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cacao-claro"
      >
        Volver al inventario
      </Link>
    </div>
  );
}
