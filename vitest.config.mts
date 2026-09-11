import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * El motor de cálculo (`src/lib/engine`) es TypeScript puro sin I/O ni
 * DOM, así que corre en el entorno `node` sin plugins de React.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Ver src/lib/__mocks__/server-only.ts.
      "server-only": fileURLToPath(new URL("./src/lib/__mocks__/server-only.ts", import.meta.url)),
    },
  },
});
