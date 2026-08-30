"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Abreviações de dia da semana em pt-BR (índice 0 = domingo). */
const DIAS_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"] as const;

interface DateSelectorProps {
  /** Data atualmente selecionada. */
  selected: Date;
  /** Callback disparado ao selecionar uma data. */
  onChange: (date: Date) => void;
}

/**
 * Seletor de data horizontal mostrando 7 dias ao redor de hoje.
 * Botões laterais permitem navegar para semanas anteriores/posteriores.
 * A data selecionada recebe fundo vermelho com glow sutil.
 */
export function DateSelector({ selected, onChange }: DateSelectorProps) {
  /** Gera array de 7 datas centradas na data selecionada. */
  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = -3; i <= 3; i++) {
      const d = new Date(selected);
      d.setDate(d.getDate() + i);
      d.setHours(0, 0, 0, 0);
      result.push(d);
    }
    return result;
  }, [selected]);

  /** Compara apenas ano/mês/dia, ignorando horário. */
  function isSameDay(a: Date, b: Date) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /** Navega N dias para frente (positivo) ou para trás (negativo). */
  function navigate(offset: number) {
    const next = new Date(selected);
    next.setDate(next.getDate() + offset);
    onChange(next);
  }

  return (
    <div className="flex items-center gap-2">
      {/* Seta esquerda */}
      <button
        type="button"
        onClick={() => navigate(-7)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-card/60 hover:text-foreground"
        aria-label="Semana anterior"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {/* Dias */}
      <div className="flex flex-1 gap-1 overflow-x-auto scrollbar-hide">
        {days.map((day) => {
          const isSelected = isSameDay(day, selected);
          const dayOfWeek = DIAS_SEMANA[day.getDay()];
          const dayNumber = day.getDate();

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onChange(day)}
              className={cn(
                "interactive flex min-w-[3rem] flex-1 flex-col items-center gap-0.5 rounded-xl py-2 transition-all",
                isSelected
                  ? "bg-primary text-white shadow-glow-primary"
                  : "bg-background-surface text-foreground-muted hover:bg-card/60 hover:text-foreground",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider">
                {dayOfWeek}
              </span>
              <span className="text-sm font-bold tabular-nums">{dayNumber}</span>
            </button>
          );
        })}
      </div>

      {/* Seta direita */}
      <button
        type="button"
        onClick={() => navigate(7)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-card/60 hover:text-foreground"
        aria-label="Próxima semana"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
