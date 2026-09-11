/**
 * Tipos del schema de Supabase.
 *
 * Espejo de la salida de `supabase gen types typescript`, recortado a lo
 * que la app usa. Si cambias una migracion, regenera y actualiza aqui.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type TipoContratoVenta = "precio_fijo_usd" | "por_fijar_ny" | "sin_contrato";
export type TipoSerie = "CC" | "TRM";
export type FuentePrecio =
  | "yahoo"
  | "barchart_api"
  | "barchart_csv"
  | "datos_gov_co"
  | "manual";
export type EstadoAnalisis = "pendiente" | "calculado" | "con_informe" | "error";

export type Database = {
  public: {
    Tables: {
      inventarios: {
        Row: {
          id: string;
          user_id: string;
          nombre: string;
          toneladas: number;
          costo_cop_kg: number;
          ubicacion: string;
          fecha_embarque: string;
          diferencial_usd_tm: number;
          tipo_contrato: TipoContratoVenta;
          precio_venta_usd_tm: number | null;
          mes_futuro: string | null;
          notas: string | null;
          activo: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          nombre: string;
          toneladas: number;
          costo_cop_kg: number;
          ubicacion: string;
          fecha_embarque: string;
          diferencial_usd_tm?: number;
          tipo_contrato?: TipoContratoVenta;
          precio_venta_usd_tm?: number | null;
          mes_futuro?: string | null;
          notas?: string | null;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["inventarios"]["Insert"]>;
        Relationships: [];
      };
      precios: {
        Row: {
          id: number;
          serie: TipoSerie;
          simbolo: string;
          fecha: string;
          apertura: number | null;
          maximo: number | null;
          minimo: number | null;
          cierre: number;
          volumen: number | null;
          fuente: FuentePrecio;
          created_at: string;
        };
        Insert: {
          serie: TipoSerie;
          simbolo: string;
          fecha: string;
          apertura?: number | null;
          maximo?: number | null;
          minimo?: number | null;
          cierre: number;
          volumen?: number | null;
          fuente: FuentePrecio;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["precios"]["Insert"]>;
        Relationships: [];
      };
      analisis: {
        Row: {
          id: string;
          user_id: string;
          inventario_id: string | null;
          estado: EstadoAnalisis;
          entradas: Json;
          mercado: Json;
          supuestos: Json;
          resultados: Json | null;
          informe_md: string | null;
          informe_meta: Json | null;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          inventario_id?: string | null;
          estado?: EstadoAnalisis;
          entradas: Json;
          mercado: Json;
          supuestos: Json;
          resultados?: Json | null;
          informe_md?: string | null;
          informe_meta?: Json | null;
          error?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["analisis"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "analisis_inventario_id_fkey";
            columns: ["inventario_id"];
            isOneToOne: false;
            referencedRelation: "inventarios";
            referencedColumns: ["id"];
          },
        ];
      };
      configuracion: {
        Row: {
          user_id: string;
          margen_inicial_usd: number;
          margen_mantenimiento_usd: number;
          comision_usd_contrato: number;
          tasa_libre_riesgo: number;
          vol_fallback: number;
          dias_habiles_anio: number;
          nivel_confianza_var: number;
          trayectorias_mc: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          margen_inicial_usd?: number;
          margen_mantenimiento_usd?: number;
          comision_usd_contrato?: number;
          tasa_libre_riesgo?: number;
          vol_fallback?: number;
          dias_habiles_anio?: number;
          nivel_confianza_var?: number;
          trayectorias_mc?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["configuracion"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      /** Una fila por serie cacheada: evita paginar `precios` para contar. */
      series_precios: {
        Row: {
          serie: TipoSerie;
          simbolo: string;
          fuente: FuentePrecio;
          barras: number;
          primera: string;
          ultima: string;
        };
        Relationships: [];
      };
    };
    Functions: Record<never, never>;
    Enums: {
      tipo_contrato_venta: TipoContratoVenta;
      tipo_serie: TipoSerie;
      fuente_precio: FuentePrecio;
      estado_analisis: EstadoAnalisis;
    };
    CompositeTypes: Record<never, never>;
  };
};

/** Fila de una tabla: `Fila<"inventarios">` */
export type Fila<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

/** Payload de insercion: `Insertar<"analisis">` */
export type Insertar<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

/** Payload de actualizacion: `Actualizar<"configuracion">` */
export type Actualizar<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
