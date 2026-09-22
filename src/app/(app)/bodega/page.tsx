import { redirect } from "next/navigation";

/**
 * Bodega e Inventario eran dos pantallas sobre el mismo cacao, y el
 * exportador pidió una sola. Se conserva la ruta para que los enlaces
 * guardados no se rompan.
 */
export default function PaginaBodega() {
  redirect("/dashboard");
}
