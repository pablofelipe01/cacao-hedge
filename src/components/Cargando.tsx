/**
 * Esqueleto de carga.
 *
 * `aria-busy` y el texto para lector de pantalla no son decoración: sin
 * ellos, quien navega con lector solo percibe que la página se quedó
 * callada.
 */
export function Cargando({ titulo = "Cargando…" }: { titulo?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">{titulo}</span>

      <div className="space-y-2">
        <div className="h-6 w-56 animate-pulse rounded bg-borde" />
        <div className="h-4 w-80 animate-pulse rounded bg-borde/60" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-borde bg-superficie" />
        ))}
      </div>

      <div className="h-64 animate-pulse rounded-lg border border-borde bg-superficie" />
    </div>
  );
}
