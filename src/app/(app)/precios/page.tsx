import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { Explicacion } from "@/components/Explicacion";
import { crearClienteServidor, obtenerUsuario } from "@/lib/supabase/server";
import { descuentoVigente } from "@/lib/data/descuento-productor";
import { COMPRADORES } from "@/lib/data/hoja-precios-productor";
import { copExacto, fechaLegible, porcentaje } from "@/lib/formato";
import { FormularioPrecios } from "./FormularioPrecios";

/** Leer la hoja sale a la red: el arranque en frío supera los 10 s por defecto. */
export const maxDuration = 30;

/**
 * Precios de compra publicados por Nacional de Chocolates y Casa Luker.
 *
 * Existe para una cosa concreta: dejar de preguntarle al usuario su
 * diferencial de memoria. Lo que aquí se mide es la distancia real entre
 * lo que pagan esos dos compradores y el futuro de Nueva York, día a día.
 */
export default async function PaginaPrecios() {
  const usuario = await obtenerUsuario();
  const supabase = await crearClienteServidor();

  const resumenes = usuario
    ? await Promise.all(
        COMPRADORES.map(async (c) => ({
          etiqueta: c.etiqueta,
          datos: await descuentoVigente(supabase, usuario.id, { comprador: c.clave }),
        })),
      )
    : [];

  const conDatos = resumenes.filter((r) => r.datos !== null);

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Precio al productor</h1>
          <Link href="/dashboard" className="text-sm text-texto-suave hover:text-texto">
            ← Inventario
          </Link>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-texto-suave">
          Nacional de Chocolates y Casa Luker fijan el precio en pesos del cacao
          colombiano. Sincronizando su hoja de seguimiento, la aplicación calcula el
          diferencial contra Nueva York en vez de pedírselo de memoria.
        </p>
      </header>

      <FormularioPrecios />

      {conDatos.length > 0 ? (
        <section aria-labelledby="medido" className="space-y-3">
          <h2 id="medido" className="text-sm font-semibold">
            Cuánto pagan y a qué distancia de Nueva York
          </h2>

          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-borde text-left text-xs text-texto-suave">
                  <th scope="col" className="py-2 pr-3 font-medium">Comprador</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    <Explicacion termino="precioProductor">Precio hoy</Explicacion>
                    <span className="block font-normal">COP/kg</span>
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    <Explicacion termino="nyEnPesos">Nueva York</Explicacion>
                    <span className="block font-normal">COP/kg</span>
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    <Explicacion termino="descuentoHoy">Descuento hoy</Explicacion>
                    <span className="block font-normal">vs. NY</span>
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    <Explicacion termino="descuentoHabitual">Habitual</Explicacion>
                    <span className="block font-normal">vs. NY</span>
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    <Explicacion termino="rangoNormal">Rango normal</Explicacion>
                    <span className="block font-normal">9 de cada 10 días</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {conDatos.map(({ etiqueta, datos }) => {
                  const r = datos!.resumen;
                  const hoy = datos!.observados[datos!.observados.length - 1];
                  // Nueva York en pesos por kilo con la TRM de ese mismo día,
                  // para que las dos columnas se comparen en la misma unidad.
                  const nyCopKg = (hoy.futuroUsdTm * hoy.precioCopKg) / hoy.precioUsdTm;
                  return (
                    <tr key={etiqueta} className="border-b border-borde last:border-0">
                      <td className="py-2 pr-3">{etiqueta}</td>
                      <td className="py-2 pr-3 text-right font-medium">
                        {copExacto(hoy.precioCopKg)}
                      </td>
                      <td className="py-2 pr-3 text-right">{copExacto(nyCopKg)}</td>
                      <td className="py-2 pr-3 text-right font-medium">
                        {porcentaje(r.actual)}
                      </td>
                      <td className="py-2 pr-3 text-right">{porcentaje(r.mediana)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {porcentaje(r.p5)} a {porcentaje(r.p95)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="max-w-prose text-xs leading-relaxed text-texto-suave">
            El «descuento hoy» es el que el formulario de análisis le propone cuando le
            falta comprar el cacao. El rango normal es lo que de verdad se mueve ese
            descuento, y es riesgo de base puro: la parte que ninguna cobertura con
            futuros toca. Toque el nombre de cada columna para ver qué significa.
          </p>

          {conDatos[0].datos ? (
            <p className="text-xs text-texto-suave">
              Cruzado contra el contrato {conDatos[0].datos.simboloCacao} de Nueva York y
              la TRM de cada día. Último dato: {fechaLegible(conDatos[0].datos.resumen.fechaActual)}.
              Historia: {conDatos[0].datos.resumen.dias} días con precio publicado y bolsa
              abierta el mismo día.
            </p>
          ) : null}
        </section>
      ) : (
        <p className="rounded-md border border-dashed border-borde px-3 py-2 text-xs text-texto-suave">
          Todavía no hay precios sincronizados, o falta la serie de cacao y la TRM en la
          caché para poder cruzarlos. Sincronice arriba y compruebe en{" "}
          <Link href="/importar" className="text-cacao hover:underline">
            Importar
          </Link>{" "}
          que haya histórico de cacao.
        </p>
      )}

      <Disclaimer />
    </div>
  );
}
