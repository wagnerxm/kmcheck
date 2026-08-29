import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Ícone exibido acima do título (dentro de um círculo). */
  icon?: LucideIcon;
  /** Título do estado vazio. */
  title: string;
  /** Descrição complementar. */
  description?: string;
  className?: string;
}

/**
 * Estado vazio premium — ícone em círculo, título e descrição centralizados.
 * Estética limpa e sóbria, sem elementos infantis.
 */
export function EmptyState({ icon: Icon, title, description, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-card-border/20">
          <Icon className="h-5 w-5 text-foreground-subtle" />
        </div>
      )}

      <p className="font-medium text-foreground-muted">{title}</p>

      {description && (
        <p className="mt-1 max-w-xs text-sm text-foreground-subtle">{description}</p>
      )}
    </div>
  );
}
