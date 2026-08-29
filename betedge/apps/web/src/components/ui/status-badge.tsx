import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** Rótulos padrão por status (pt-BR). */
const DEFAULT_LABELS: Record<StatusBadgeStatus, string> = {
  collecting: "Coletando",
  active: "Ativo",
  inactive: "Inativo",
  warning: "Atenção",
  error: "Erro",
};

type StatusBadgeStatus = "collecting" | "active" | "inactive" | "warning" | "error";

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        collecting:
          "bg-primary/10 text-primary-400 border border-primary/20",
        active:
          "bg-success/10 text-success border border-success/20",
        inactive:
          "bg-card-border/30 text-foreground-subtle border border-card-border/40",
        warning:
          "bg-warning/10 text-warning border border-warning/20",
        error:
          "bg-danger/10 text-danger border border-danger/20",
      },
    },
    defaultVariants: {
      status: "inactive",
    },
  },
);

const dotVariants = cva("h-1.5 w-1.5 rounded-full", {
  variants: {
    status: {
      collecting: "bg-primary animate-pulse",
      active: "bg-success",
      inactive: "bg-foreground-subtle",
      warning: "bg-warning",
      error: "bg-danger",
    },
  },
  defaultVariants: {
    status: "inactive",
  },
});

interface StatusBadgeProps extends VariantProps<typeof statusBadgeVariants> {
  /** Status representado pelo badge. */
  status: StatusBadgeStatus;
  /** Rótulo customizado (se omitido, usa o padrão em pt-BR). */
  label?: string;
  className?: string;
}

/**
 * Badge de status em formato pílula com dot colorido.
 * Usa CVA para variantes consistentes. O status "collecting"
 * pulsa para indicar atividade em andamento.
 */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  return (
    <span className={cn(statusBadgeVariants({ status }), className)}>
      <span className={dotVariants({ status })} />
      {label ?? DEFAULT_LABELS[status]}
    </span>
  );
}
