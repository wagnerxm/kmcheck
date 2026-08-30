import { defineConfig } from "vitest/config";

/**
 * Configuração do Vitest para @betedge/utils — testes unitários dos
 * utilitários puros de odds, formatação e datas.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
