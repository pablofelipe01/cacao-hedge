/**
 * Errores de la capa de datos.
 *
 * Un fallo al traer precios no debe llegar al usuario como "500" ni como
 * el mensaje crudo de una API en inglés. Cada error lleva el proveedor
 * que falló, si tiene sentido reintentar y un texto en español que dice
 * qué hacer.
 */

export type CausaError =
  | "sin_credenciales"
  | "red"
  | "tiempo_agotado"
  | "limite_peticiones"
  | "respuesta_invalida"
  | "sin_datos"
  | "servidor_externo"
  | "no_autorizado";

export class ErrorDatos extends Error {
  readonly proveedor: string;
  readonly causa: CausaError;
  readonly reintentable: boolean;
  readonly estadoHttp?: number;

  constructor(
    proveedor: string,
    causa: CausaError,
    mensaje: string,
    opciones: { reintentable?: boolean; estadoHttp?: number; cause?: unknown } = {},
  ) {
    super(mensaje, { cause: opciones.cause });
    this.name = "ErrorDatos";
    this.proveedor = proveedor;
    this.causa = causa;
    this.estadoHttp = opciones.estadoHttp;
    this.reintentable = opciones.reintentable ?? esReintentablePorDefecto(causa);
  }

  /** Mensaje listo para mostrar en la interfaz. */
  get mensajeUsuario(): string {
    switch (this.causa) {
      case "sin_credenciales":
        return `${this.proveedor} no está configurado. Revise las variables de entorno.`;
      case "red":
        return `No se pudo conectar con ${this.proveedor}. Verifique su conexión e intente de nuevo.`;
      case "tiempo_agotado":
        return `${this.proveedor} tardó demasiado en responder. Intente de nuevo en unos minutos.`;
      case "limite_peticiones":
        // Medido contra Yahoo: un bloqueo por IP puede durar media hora
        // larga, no "unos minutos". Prometer menos sería engañar, así que
        // el mensaje apunta a la salida que no depende de esperar.
        return `${this.proveedor} está limitando las consultas por exceso de peticiones y el bloqueo puede durar media hora o más. Si necesita el análisis ahora, importe el histórico en CSV.`;
      case "no_autorizado":
        return `${this.proveedor} rechazó las credenciales. Verifique la API key.`;
      case "sin_datos":
        return `${this.proveedor} no devolvió datos para el período solicitado.`;
      case "respuesta_invalida":
        return `${this.proveedor} devolvió una respuesta que no se pudo interpretar.`;
      case "servidor_externo":
        return `${this.proveedor} presenta una falla temporal. Intente más tarde.`;
    }
  }
}

function esReintentablePorDefecto(causa: CausaError): boolean {
  return causa === "red" || causa === "tiempo_agotado" || causa === "servidor_externo";
}
