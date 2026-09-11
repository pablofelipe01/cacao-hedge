import type { ReactNode } from "react";

/**
 * Renderizador de Markdown acotado al subconjunto que produce el informe:
 * encabezados de nivel 2 y 3, listas, negrita y párrafos.
 *
 * Construye elementos de React en vez de inyectar HTML. El texto lo
 * escribe un modelo de lenguaje y, aunque el prompt sea nuestro, tratar
 * su salida como marcado confiable sería abrir una vía de inyección sin
 * ninguna necesidad: aquí no hay `dangerouslySetInnerHTML`.
 */

/** Convierte **negrita** en elementos, dejando el resto como texto plano. */
function conNegrita(linea: string): ReactNode[] {
  return linea.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith("**") && parte.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {parte.slice(2, -2)}
      </strong>
    ) : (
      parte
    ),
  );
}

export function Markdown({ texto }: { texto: string }) {
  const bloques: ReactNode[] = [];
  const lineas = texto.split("\n");
  let listaAbierta: string[] = [];
  let parrafo: string[] = [];

  const cerrarLista = () => {
    if (listaAbierta.length === 0) return;
    bloques.push(
      <ul key={`ul-${bloques.length}`} className="my-3 space-y-1.5 pl-5">
        {listaAbierta.map((item, i) => (
          <li key={i} className="list-disc leading-relaxed marker:text-cacao-claro">
            {conNegrita(item)}
          </li>
        ))}
      </ul>,
    );
    listaAbierta = [];
  };

  const cerrarParrafo = () => {
    if (parrafo.length === 0) return;
    bloques.push(
      <p key={`p-${bloques.length}`} className="my-3 leading-relaxed">
        {conNegrita(parrafo.join(" "))}
      </p>,
    );
    parrafo = [];
  };

  for (const cruda of lineas) {
    const linea = cruda.trim();

    if (linea === "") {
      cerrarParrafo();
      cerrarLista();
      continue;
    }

    if (linea.startsWith("### ")) {
      cerrarParrafo();
      cerrarLista();
      bloques.push(
        <h4 key={`h4-${bloques.length}`} className="mt-5 mb-1 text-sm font-semibold">
          {conNegrita(linea.slice(4))}
        </h4>,
      );
      continue;
    }

    if (linea.startsWith("## ")) {
      cerrarParrafo();
      cerrarLista();
      bloques.push(
        <h3
          key={`h3-${bloques.length}`}
          className="mt-6 mb-2 border-b border-borde pb-1 text-base font-semibold first:mt-0"
        >
          {conNegrita(linea.slice(3))}
        </h3>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(linea)) {
      cerrarParrafo();
      listaAbierta.push(linea.replace(/^[-*]\s+/, ""));
      continue;
    }

    cerrarLista();
    parrafo.push(linea);
  }

  cerrarParrafo();
  cerrarLista();

  return <div className="text-sm">{bloques}</div>;
}
