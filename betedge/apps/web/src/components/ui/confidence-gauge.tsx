"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ConfidenceGaugeProps {
  /** Valor de confiança entre 0 e 100. */
  value: number;
  /** Tamanho do gauge. */
  size?: "sm" | "md";
  className?: string;
}

/** Dimensões por tamanho (largura × altura do SVG). */
const SIZES = {
  sm: { width: 28, height: 80, barWidth: 8, fontSize: 10, labelSize: 7 },
  md: { width: 36, height: 120, barWidth: 12, fontSize: 13, labelSize: 9 },
} as const;

/**
 * Gauge vertical de confiança (0–100), estilo termômetro.
 * Preenchimento vermelho de baixo para cima, proporcional ao valor.
 * Anima na montagem com CSS transition para entrada suave.
 */
export function ConfidenceGauge({
  value,
  size = "md",
  className,
}: ConfidenceGaugeProps) {
  const [animated, setAnimated] = useState(false);
  const clamped = Math.max(0, Math.min(100, value));
  const s = SIZES[size];

  /* Margem interna do SVG para texto e marcadores. */
  const padding = { top: 16, bottom: 24 };
  const barHeight = s.height - padding.top - padding.bottom;
  const fillHeight = animated ? (clamped / 100) * barHeight : 0;
  const barX = (s.width - s.barWidth) / 2;
  const barY = padding.top;

  useEffect(() => {
    /* Pequeno delay para disparar a transição após a montagem. */
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg
        width={s.width}
        height={s.height}
        viewBox={`0 0 ${s.width} ${s.height}`}
        fill="none"
        aria-label={`Confiança: ${clamped}%`}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Trilho de fundo */}
        <rect
          x={barX}
          y={barY}
          width={s.barWidth}
          height={barHeight}
          rx={s.barWidth / 2}
          className="fill-card-border/30"
        />

        {/* Preenchimento animado (de baixo para cima) */}
        <rect
          x={barX}
          y={barY + barHeight - fillHeight}
          width={s.barWidth}
          height={fillHeight}
          rx={s.barWidth / 2}
          className="fill-primary"
          style={{ transition: "height 0.8s ease-out, y 0.8s ease-out" }}
        />

        {/* Marcador 100 */}
        <text
          x={s.width / 2}
          y={barY - 4}
          textAnchor="middle"
          className="fill-foreground-subtle"
          fontSize={s.labelSize}
          fontFamily="var(--font-inter), system-ui, sans-serif"
        >
          100
        </text>

        {/* Marcador 0 */}
        <text
          x={s.width / 2}
          y={barY + barHeight + 12}
          textAnchor="middle"
          className="fill-foreground-subtle"
          fontSize={s.labelSize}
          fontFamily="var(--font-inter), system-ui, sans-serif"
        >
          0
        </text>

        {/* Valor no topo do preenchimento */}
        {animated && clamped > 0 && (
          <text
            x={s.width / 2}
            y={barY + barHeight - fillHeight - 4}
            textAnchor="middle"
            className="fill-foreground font-bold"
            fontSize={s.fontSize}
            fontFamily="var(--font-inter), system-ui, sans-serif"
            style={{ transition: "y 0.8s ease-out" }}
          >
            {clamped}
          </text>
        )}
      </svg>

      {/* Rótulo abaixo do gauge */}
      <span className="mt-1 text-[9px] font-bold uppercase tracking-widest text-foreground-subtle">
        Confiança
      </span>
    </div>
  );
}
