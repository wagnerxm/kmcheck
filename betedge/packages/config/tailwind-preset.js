/**
 * Preset do Tailwind — PREDIQ Design System v2.
 *
 * Direção visual: sports performance app + quantitative analytics + premium betting intelligence.
 * Fundo preto profundo, acento vermelho vivo, verde apenas para valores positivos.
 * Sem estética cassino, sem neon, sem poluição visual.
 *
 * Uso: `presets: [require("@betedge/config/tailwind-preset")]` no tailwind.config.ts do app.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Plano de fundo — preto profundo, sem tonalidade azulada.
        background: {
          DEFAULT: "#09090B",   // zinc-950
          surface: "#141416",   // grafite escuro para cards
          elevated: "#1C1C1F",  // superfícies elevadas (modais, drawers)
        },
        // Cartões premium — opacos, não glass excessivo.
        card: {
          DEFAULT: "rgba(24, 24, 27, 0.85)",  // zinc-900 com leve transparência
          border: "rgba(255, 255, 255, 0.07)", // borda branca ultra-sutil
          hover: "rgba(255, 255, 255, 0.04)",  // hover leve
        },
        // Acento principal — vermelho vivo para CTAs, highlights, elementos ativos.
        primary: {
          DEFAULT: "#DC2626",   // red-600
          foreground: "#FFFFFF",
          50:  "#FEF2F2",
          100: "#FEE2E2",
          200: "#FECACA",
          300: "#FCA5A5",
          400: "#F87171",
          500: "#EF4444",
          600: "#DC2626",
          700: "#B91C1C",
          800: "#991B1B",
          900: "#7F1D1D",
        },
        // Verde — EXCLUSIVAMENTE para valores positivos / tendência de alta.
        success: {
          DEFAULT: "#22C55E",   // green-500
          foreground: "#052E16",
          50:  "#F0FDF4",
          400: "#4ADE80",
          500: "#22C55E",
          600: "#16A34A",
        },
        // Estados de risco/alerta.
        danger: {
          DEFAULT: "#EF4444",
          foreground: "#450A0A",
        },
        warning: {
          DEFAULT: "#F59E0B",
          foreground: "#451A03",
        },
        // Hierarquia de texto.
        foreground: {
          DEFAULT: "#FAFAFA",   // branco levemente quente
          muted:   "#A1A1AA",   // zinc-400
          subtle:  "#52525B",   // zinc-600
        },
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glass:          "0 8px 32px 0 rgba(0, 0, 0, 0.45)",
        "glow-primary": "0 0 20px 0 rgba(220, 38, 38, 0.20)",
        "glow-success": "0 0 16px 0 rgba(34, 197, 94, 0.15)",
        card:           "0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 1px 2px -1px rgba(0, 0, 0, 0.3)",
        "card-hover":   "0 4px 12px 0 rgba(0, 0, 0, 0.4)",
      },
      borderRadius: {
        xl:   "0.875rem",
        "2xl": "1.25rem",
      },
      fontFamily: {
        sans:    ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-barlow)", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Escala tipográfica para hierarquia forte.
        "display-xl": ["3rem",    { lineHeight: "1",   letterSpacing: "-0.02em", fontWeight: "800" }],
        "display-lg": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-md": ["1.5rem",  { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "700" }],
        "display-sm": ["1.125rem",{ lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
      },
      keyframes: {
        "fade-in": {
          "0%":   { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%":   { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        "gauge-fill": {
          "0%":   { strokeDashoffset: "100" },
          "100%": { strokeDashoffset: "var(--gauge-value)" },
        },
        "slide-up": {
          "0%":   { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "fade-in":     "fade-in 0.2s ease-out",
        "fade-in-up":  "fade-in-up 0.3s ease-out",
        "scale-in":    "scale-in 0.2s ease-out",
        shimmer:       "shimmer 2s infinite linear",
        "gauge-fill":  "gauge-fill 1s ease-out forwards",
        "slide-up":    "slide-up 0.3s ease-out",
      },
    },
  },
  plugins: [],
};
