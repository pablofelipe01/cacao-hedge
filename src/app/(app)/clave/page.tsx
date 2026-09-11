import { Disclaimer } from "@/components/Disclaimer";
import { obtenerUsuario } from "@/lib/supabase/server";
import { FormularioClave } from "./FormularioClave";

export default async function PaginaClave() {
  const usuario = await obtenerUsuario();

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Establecer contraseña</h1>
        <p className="text-sm text-texto-suave">
          {usuario?.email
            ? `Para la cuenta ${usuario.email}.`
            : "Necesita un enlace válido para llegar aquí."}
        </p>
      </header>

      <FormularioClave />
      <Disclaimer />
    </div>
  );
}
