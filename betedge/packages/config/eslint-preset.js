/**
 * Configuração compartilhada do ESLint para o monorepo BetEdge.
 * Combina as regras recomendadas do Next.js com regras de TypeScript.
 * Usado via `extends: ["@betedge/config/eslint-preset"]` nos apps/pacotes.
 */
module.exports = {
  root: true,
  extends: [
    "eslint:recommended",
    "next/core-web-vitals",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: false,
  },
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  rules: {
    // Evita alarme falso em variáveis de tipo/props não usadas propositalmente.
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/consistent-type-imports": [
      "warn",
      { prefer: "type-imports" },
    ],
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "react/no-unescaped-entities": "off",
  },
  ignorePatterns: [
    "node_modules/",
    ".next/",
    "dist/",
    ".turbo/",
    "out/",
  ],
};
