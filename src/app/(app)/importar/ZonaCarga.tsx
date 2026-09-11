"use client";

import { useRef, useState, type DragEvent } from "react";

interface Props {
  id: string;
  name: string;
  /** Se llama al elegir o soltar un archivo. */
  onArchivo?: (archivo: File | null) => void;
}

/** Icono de carga. `aria-hidden` porque el texto contiguo ya lo explica. */
function IconoCarga({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v13" />
    </svg>
  );
}

function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("es-CO", { maximumFractionDigits: 0 })} kB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`;
}

/**
 * Zona de carga con arrastrar y soltar.
 *
 * El `<input type="file">` sigue siendo el control real —queda visualmente
 * oculto pero accesible— para no perder el teclado ni los lectores de
 * pantalla: el recuadro es una comodidad encima, no un sustituto.
 */
export function ZonaCarga({ id, name, onArchivo }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);

  const registrar = (elegido: File | null) => {
    setArchivo(elegido);
    onArchivo?.(elegido);
  };

  const alSoltar = (evento: DragEvent<HTMLDivElement>) => {
    evento.preventDefault();
    setEncima(false);

    const soltado = evento.dataTransfer.files?.[0];
    if (!soltado || !entrada.current) return;

    // Se transfiere al input real para que el archivo viaje en el FormData.
    const contenedor = new DataTransfer();
    contenedor.items.add(soltado);
    entrada.current.files = contenedor.files;
    registrar(soltado);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={alSoltar}
      className={`rounded-lg border border-dashed p-6 text-center transition ${
        encima ? "border-cacao bg-cacao/5" : "border-borde bg-fondo"
      }`}
    >
      <input
        ref={entrada}
        id={id}
        name={name}
        type="file"
        accept=".csv,text/csv"
        required
        onChange={(e) => registrar(e.target.files?.[0] ?? null)}
        className="sr-only"
      />

      <IconoCarga className="mx-auto h-8 w-8 text-cacao-claro" />

      <label
        htmlFor={id}
        className="mt-3 block cursor-pointer text-sm font-medium text-cacao hover:underline"
      >
        {archivo ? "Elegir otro archivo" : "Seleccionar archivo CSV"}
      </label>

      <p className="mt-1 text-xs text-texto-suave">
        {archivo ? (
          <span className="tabular">
            {archivo.name} · {pesoLegible(archivo.size)}
          </span>
        ) : (
          "o arrástrelo aquí"
        )}
      </p>
    </div>
  );
}
