import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El proyecto no está en la raíz de un repositorio git, así que hay que
  // decirle a Turbopack dónde empieza el workspace o busca hacia arriba.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
