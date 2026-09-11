import { redirect } from "next/navigation";

/** La raíz no tiene contenido propio: el middleware decide login o dashboard. */
export default function Inicio() {
  redirect("/dashboard");
}
