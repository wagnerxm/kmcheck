"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface PrediqScoreGaugeProps {
  /** Score entre 0 e 100. */
  score: number;
  /** Rótulo abaixo do gauge (ex.: "PREDIQ Score"). */
  label?: string;
  /** Tamanho do componente. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Dimensões do SVG e tipografia por tamanho. */
const SIZES = {
  sm: { px: 48, stroke: 4, scoreFontSize: 14, subFontSize: 7, labelFontSize: 8 },
  md: { px: 64, stroke: 5, scoreFontSize: 18, subFontSize: 9, labelFontSize: 9 },
  lg: { px: 96, stroke: 6, scoreFontSize: 28, subFontSize: 12, labelFontSize: 10 },
} as const;

/**
 * Gauge circular (donut) do PREDIQ Score.
 * Arco vermelho sobre trilho discreto, número grande no centro.
 * Animação de stroke-dashoffset na montagem.
 */
export function PrediqScoreGauge({
  score,
  label,
  size = "md",
  className,
}: PrediqScoreGaugeProps) {
  const [animated, setAnimated] = useState(false);
  const clamped = Math.max(0, Math.min(100, score));
  const s = SIZES[size];

  const radius = (s.px - s.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = animated
    ? circumference - (clamped / 100) * circumference
    : circumference;

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg
        width={s.px}
        height={s.px}
        viewBox={`0 0 ${s.px} ${s.px}`}
        fill="none"
        aria-label={`PREDIQ Score: ${clamped}/100`}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* Trilho de fundo */}
        <circle
          cx={s.px / 2}
          cy={s.px / 2}
          r={radius}
          strokeWidth={s.stroke}
          className="stroke-card-border/30"
        />

        {/* Arco de progresso */}
        <circle
          cx={s.px / 2}
          cy={s.px / 2}
          r={radius}
          strokeWidth={s.stroke}
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${s.px / 2} ${s.px / 2})`}
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />

        {/* Valor central */}
        <text
          x={s.px / 2}
          y={s.px / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground font-bold"
          fontSize={s.scoreFontSize}
          fontFamily="var(--font-inter), system-ui, sans-serif"
          dy={-s.subFontSize / 2}
        >
          {clamped}
        </text>

        {/* "/100" abaixo do valor */}
        <text
          x={s.px / 2}
          y={s.px / 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-foreground-muted"
          fontSize={s.subFontSize}
          fontFamily="var(--font-inter), system-ui, sans-serif"
          dy={s.scoreFontSize / 2}
        >
          /100
        </text>
      </svg>

      {label && (
        <span
          className="mt-1 font-bold uppercase tracking-widest text-foreground-subtle"
          style={{ fontSize: s.labelFontSize }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
