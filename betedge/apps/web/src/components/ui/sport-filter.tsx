"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SportFilterOption {
  id: string;
  label: string;
  icon?: LucideIcon;
}

interface SportFilterProps {
  /** Lista de esportes/filtros disponíveis. */
  options: SportFilterOption[];
  /** ID do filtro selecionado no momento. */
  selected: string;
  /** Callback disparado ao trocar de filtro. */
  onChange: (id: string) => void;
}

/**
 * Faixa horizontal de chips de filtro por esporte/categoria.
 * Rola lateralmente sem scrollbar visível (estética limpa em mobile).
 * Chip ativo recebe fundo vermelho com glow; inativos ficam discretos.
 */
export function SportFilter({ options, selected, onChange }: SportFilterProps) {
  return (
    <div
      className="flex gap-2 overflow-x-auto scrollbar-hide"
      role="tablist"
      aria-label="Filtro de esportes"
    >
      {options.map((option) => {
        const isActive = option.id === selected;
        const Icon = option.icon;

        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              "interactive flex shrink-0 items-center gap-2 whitespace-nowrap",
              isActive ? "filter-chip-active" : "filter-chip",
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
