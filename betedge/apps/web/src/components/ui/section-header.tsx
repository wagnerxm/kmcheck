import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  /** Título da seção (renderizado em uppercase). */
  title: string;
  /** Botão de ação opcional exibido à direita do título. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * Cabeçalho de seção com barra vermelha indicadora à esquerda.
 * Segue a identidade PREDIQ: tipografia display condensada, caixa alta,
 * espaçamento largo — reforça hierarquia sem poluição visual.
 */
export function SectionHeader({ title, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div className="flex items-center gap-3">
        <div className="section-indicator" />
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-foreground">
          {title}
        </h2>
      </div>

      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="text-sm font-medium text-primary transition-colors hover:text-primary-400"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
