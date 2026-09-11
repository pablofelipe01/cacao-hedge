/**
 * Lectura del inventario real desde la hoja de cálculo operativa.
 *
 * La hoja es la fuente de verdad de cuánto cacao hay en bodega. Esta capa
 * la traduce a filas normalizadas; no decide nada de negocio.
 *
 * Dos cuidados que impone la estructura de la hoja:
 *
 *  1. El encabezado ocupa tres filas y hay **dos** columnas llamadas
 *     «CANTIDAD DISPONIBLE EN BODEGA»: la de la sección ENTRADAS (la que
 *     importa) y otra en CLASIFICACION desglosada por calidad. Localizar
 *     la columna por nombre a secas tomaría la equivocada, así que se
 *     busca la primera y se verifica su posición.
 *  2. Los números vienen en convención colombiana y entrecomillados
 *     («1580,6»), y algunas celdas traen errores de fórmula (#DIV/0!).
 */

import { ErrorDatos } from "./errores";
import { esFechaIso } from "./fechas";
import { obtenerTexto, type OpcionesPeticion } from "./http";

const NOMBRE = "Hoja de inventario";

/** Fila de la hoja con saldo en bodega. */
export interface FilaBodega {
  /** Número de fila en la hoja, 1-indexado. Trazabilidad hasta el origen. */
  fila: number;
  fechaIngreso: string | null;
  codigoProcedencia: string;
  valorCompraCopKg: number | null;
  cantidadIngresadaKg: number | null;
  cantidadSalidaKg: number | null;
  cantidadDisponibleKg: number;
}

export interface InventarioHoja {
  filas: FilaBodega[];
  /** Suma de la columna de disponible, en kilogramos. */
  totalKg: number;
  /** El total que declara la propia hoja, si lo trae. */
  totalDeclaradoKg: number | null;
  /** true si la suma coincide con el total declarado por la hoja. */
  totalCuadra: boolean;
  /** Índice 0-based de la columna de disponible que se utilizó. */
  columnaDisponible: number;
}

/** Divide un CSV respetando comillas y saltos de línea dentro de campo. */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (c === '"') {
      if (entreComillas && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (c === "," && !entreComillas) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" && !entreComillas) {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r" || entreComillas) {
      campo += c;
    }
  }

  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/**
 * Interpreta una celda numérica de la hoja.
 *
 * Acepta el formato colombiano («15.274,65»), quita el símbolo de peso de
 * la columna de valor de compra y descarta los errores de fórmula, que en
 * la hoja aparecen como #DIV/0! en las filas sin datos.
 */
export function numeroDeCelda(valor: string | undefined): number | null {
  const limpio = (valor ?? "").replace(/[$\s]/g, "").trim();
  if (limpio === "" || limpio.startsWith("#")) return null;

  const numero = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) ? numero : null;
}

/** Meses como los escribe la hoja: «2-jul-2026», «9-sept-2026». */
const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sept: 9, sep: 9, oct: 10, nov: 11, dic: 12,
};

/** Convierte una fecha de la hoja a ISO, o null si no se reconoce. */
export function fechaDeCelda(valor: string | undefined): string | null {
  const texto = (valor ?? "").trim().toLowerCase();
  if (!texto) return null;

  // Formato con mes en letras: 2-jul-2026.
  const conLetras = texto.match(/^(\d{1,2})-([a-záéíóú]+)-(\d{4})$/);
  if (conLetras) {
    const mes = MESES[conLetras[2]];
    if (!mes) return null;
    const iso = `${conLetras[3]}-${String(mes).padStart(2, "0")}-${conLetras[1].padStart(2, "0")}`;
    return esFechaIso(iso) ? iso : null;
  }

  // Formato numérico: 22/11/25 o 22-11-25.
  const numerico = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numerico) {
    const anio = numerico[3].length === 2 ? `20${numerico[3]}` : numerico[3];
    const iso = `${anio}-${numerico[2].padStart(2, "0")}-${numerico[1].padStart(2, "0")}`;
    return esFechaIso(iso) ? iso : null;
  }

  return null;
}

/** Posiciones de las columnas que interesan, según el encabezado de la hoja. */
export interface Columnas {
  fecha: number;
  codigo: number;
  valorCompra: number;
  ingresada: number;
  salida: number;
  disponible: number;
}

/**
 * Localiza las columnas leyendo el encabezado.
 *
 * Se busca la PRIMERA «CANTIDAD DISPONIBLE EN BODEGA»: la segunda
 * pertenece a la sección de clasificación por calidad y sumarla daría el
 * doble. Se exige además que vaya después de «CANTIDAD SALIDA», que es su
 * posición en la sección de entradas.
 */
export function localizarColumnas(filas: string[][]): Columnas {
  const normalizar = (v: string) =>
    v.trim().toUpperCase().replace(/\s+/g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "");

  // El encabezado ocupa varias filas; se busca en las primeras seis.
  let encabezado: string[] | null = null;
  let indiceDisponible = -1;

  for (const fila of filas.slice(0, 6)) {
    const posicion = fila.findIndex((c) => normalizar(c) === "CANTIDAD DISPONIBLE EN BODEGA");
    if (posicion !== -1) {
      encabezado = fila;
      indiceDisponible = posicion;
      break;
    }
  }

  if (!encabezado || indiceDisponible === -1) {
    throw new ErrorDatos(
      NOMBRE,
      "respuesta_invalida",
      "No se encontró la columna «CANTIDAD DISPONIBLE EN BODEGA» en el encabezado de la hoja.",
    );
  }

  const buscar = (etiqueta: string) =>
    encabezado.findIndex((c) => normalizar(c) === etiqueta);

  const salida = buscar("CANTIDAD SALIDA");
  if (salida !== -1 && salida > indiceDisponible) {
    throw new ErrorDatos(
      NOMBRE,
      "respuesta_invalida",
      "La columna de disponible aparece antes que la de salida: la estructura de la hoja cambió y hay que revisar el importador.",
    );
  }

  return {
    fecha: 0,
    codigo: buscar("CODIGO DE PROCEDENCIA"),
    valorCompra: buscar("VALOR DE COMPRA"),
    ingresada: buscar("CANTIDAD INGRESADA (KG)"),
    salida,
    disponible: indiceDisponible,
  };
}

/**
 * Interpreta la hoja completa y devuelve solo las filas con saldo.
 *
 * Las filas sin código de procedencia son totales, separadores o restos
 * de plantilla; incluirlas contaría existencias que no están.
 */
export function interpretarHoja(csv: string): InventarioHoja {
  const filas = parsearCsv(csv);
  const col = localizarColumnas(filas);

  if (col.codigo === -1) {
    throw new ErrorDatos(
      NOMBRE,
      "respuesta_invalida",
      "La hoja no tiene columna «CODIGO DE PROCEDENCIA»; sin ella no se puede identificar cada lote.",
    );
  }

  const conSaldo: FilaBodega[] = [];
  let totalDeclaradoKg: number | null = null;

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const codigo = (fila[col.codigo] ?? "").trim();
    const disponible = numeroDeCelda(fila[col.disponible]);

    // Fila de totales: trae cifra pero no identifica ningún lote.
    if (!codigo && disponible !== null && disponible > 0) {
      totalDeclaradoKg = disponible;
      continue;
    }

    if (!codigo || disponible === null || disponible <= 0) continue;

    conSaldo.push({
      fila: i + 1,
      fechaIngreso: fechaDeCelda(fila[col.fecha]),
      codigoProcedencia: codigo,
      valorCompraCopKg: col.valorCompra === -1 ? null : numeroDeCelda(fila[col.valorCompra]),
      cantidadIngresadaKg: col.ingresada === -1 ? null : numeroDeCelda(fila[col.ingresada]),
      cantidadSalidaKg: col.salida === -1 ? null : numeroDeCelda(fila[col.salida]),
      cantidadDisponibleKg: disponible,
    });
  }

  const totalKg = conSaldo.reduce((suma, f) => suma + f.cantidadDisponibleKg, 0);

  return {
    filas: conSaldo,
    totalKg,
    totalDeclaradoKg,
    // Tolerancia de medio kilo: la hoja redondea al mostrar.
    totalCuadra:
      totalDeclaradoKg === null || Math.abs(totalDeclaradoKg - totalKg) < 0.5,
    columnaDisponible: col.disponible,
  };
}

/**
 * Hoja operativa de inventario por defecto.
 *
 * Vive aquí y no en la acción de servidor porque un módulo `"use server"`
 * solo puede exportar funciones asíncronas: una constante exportada desde
 * allí rompe la compilación del bundle de cliente.
 */
export const HOJA_INVENTARIO_POR_DEFECTO = "1ozHRoAKiNNwMHOMCY-lwYaoJYxba71lo6sr1ltsg094";

/** Extrae el identificador de una URL de Google Sheets, o lo devuelve tal cual. */
export function idDeHoja(entrada: string): string {
  const texto = entrada.trim();
  const coincidencia = texto.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return coincidencia ? coincidencia[1] : texto;
}

/** URL de exportación a CSV de una hoja de Google. */
export function urlExportacion(hojaId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(hojaId)}/export?format=csv`;
}

/**
 * Descarga la hoja y la interpreta.
 *
 * Usa la exportación pública a CSV, que funciona cuando la hoja está
 * compartida por enlace. Es la contrapartida de esa comodidad: cualquiera
 * con el enlace puede leerla, así que la decisión de compartirla es del
 * dueño de la hoja y conviene que sea consciente.
 */
export async function descargarInventario(
  hojaId: string,
  opciones: Partial<OpcionesPeticion> = {},
): Promise<InventarioHoja> {
  const csv = await obtenerTexto(urlExportacion(hojaId), {
    proveedor: NOMBRE,
    ...opciones,
  });

  // Si la hoja no es pública, Google devuelve una página de inicio de sesión.
  if (/^\s*</.test(csv)) {
    throw new ErrorDatos(
      NOMBRE,
      "no_autorizado",
      "La hoja no es accesible por enlace: Google devolvió una página de acceso en vez del CSV. Compártala como «cualquiera con el enlace puede ver».",
    );
  }

  return interpretarHoja(csv);
}

/** Kilogramos a toneladas métricas, que es la unidad del motor. */
export function aToneladas(kilogramos: number): number {
  return kilogramos / 1000;
}
