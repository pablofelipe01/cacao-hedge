/**
 * Aviso legal. Debe ser visible en toda vista que muestre cifras de
 * cobertura: la herramienta apoya decisiones, no las reemplaza.
 */
export function Disclaimer() {
  return (
    <p className="rounded-md border border-borde bg-superficie px-3 py-2 text-xs leading-relaxed text-texto-suave">
      <strong className="font-semibold text-texto">Aviso:</strong> CacaoHedge es una
      herramienta de apoyo a decisiones y <strong>no constituye asesoría financiera,
      de inversión ni tributaria</strong>. Los precios pueden estar diferidos o ser
      aproximados, y los escenarios son ilustrativos. Verifique márgenes, comisiones y
      condiciones con su bróker y su asesor antes de operar.
    </p>
  );
}
