import type { Config } from "tailwindcss";

/**
 * Configuração do Tailwind do app web. O tema visual (cores, tipografia,
 * animações) vive centralizado no preset @betedge/config para que qualquer
 * app futuro do monorepo (ex.: painel admin) compartilhe a mesma identidade.
 */
const config: Config = {
  presets: [require("@betedge/config/tailwind-preset")],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
};

export default config;
