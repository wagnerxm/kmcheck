/**
 * Preset do Tailwind com o tema visual do BetEdge: dark mode "quant trading desk",
 * não "cassino". Cores sóbrias (slate) com um único acento (emerald) para destacar
 * oportunidades de valor positivo.
 *
 * Uso: `presets: [require("@betedge/config/tailwind-preset")]` no tailwind.config.ts do app.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Plano de fundo geral da aplicação.
        background: {
          DEFAULT: "#020617", // slate-950
          surface: "#0f172a", // slate-900
        },
        // Cartões com efeito de vidro (glass morphism).
        card: {
          DEFAULT: "rgba(30, 41, 59, 0.5)", // slate-800/50
          border: "rgba(51, 65, 85, 0.5)", // slate-700/50
        },
        // Acento primário — usado para valor positivo, CTAs, links ativos.
        primary: {
          DEFAULT: "#10b981", // emerald-500
          foreground: "#022c22",
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        // Estados de risco/alerta.
        danger: {
          DEFAULT: "#ef4444", // red-500
          foreground: "#450a0a",
        },
        warning: {
          DEFAULT: "#f59e0b", // amber-500
          foreground: "#451a03",
        },
        // Hierarquia de texto.
        foreground: {
          DEFAULT: "#f8fafc", // slate-50
          muted: "#cbd5e1", // slate-300
          subtle: "#64748b", // slate-500
        },
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        "glow-primary": "0 0 24px 0 rgba(16, 185, 129, 0.25)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        shimmer: "shimmer 2s infinite linear",
      },
    },
  },
  plugins: [],
};
