import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Configuração mínima do Vitest para testes unitários do app web. Não usamos
 * plugin do Next.js aqui de propósito — a suíte desta fase cobre apenas
 * utilitários puros (sem JSX/DOM), então o ambiente `node` padrão já basta e
 * mantém a execução rápida no CI.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
