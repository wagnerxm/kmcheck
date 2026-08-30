import { cn } from "@/lib/utils";

interface MetricCardProps {
  /** Rótulo descritivo (renderizado em uppercase). */
  label: string;
  /** Valor principal da métrica. */
  value: string | number;
  /** Texto complementar exibido abaixo do valor. */
  subtitle?: string;
  /** Indicador de tendência (seta + texto colorido). */
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
  /** Variante visual do card. */
  variant?: "default" | "accent" | "compact";
  className?: string;
}

/**
 * Card premium de métrica — exibe um KPI com rótulo, valor grande,
 * subtítulo opcional e indicador de tendência colorido.
 */
export function MetricCard({
  label,
  value,
  subtitle,
  trend,
  variant = "default",
  className,
}: MetricCardProps) {
  const isCompact = variant === "compact";

  return (
    <div
      className={cn(
        variant === "accent" ? "card-accent" : "card-premium",
        isCompact ? "p-3" : "p-5",
        className,
      )}
    >
      {/* Rótulo */}
      <p
        className={cn(
          "font-medium uppercase tracking-wider text-foreground-subtle",
          isCompact ? "text-[10px]" : "text-xs",
        )}
      >
        {label}
      </p>

      {/* Valor */}
      <p
        className={cn(
          "font-bold tabular-nums text-foreground",
          isCompact ? "text-lg" : "text-2xl",
        )}
      >
        {value}
      </p>

      {/* Subtítulo */}
      {subtitle && (
        <p
          className={cn(
            "text-foreground-muted",
            isCompact ? "text-[10px]" : "text-xs",
          )}
        >
          {subtitle}
        </p>
      )}

      {/* Tendência */}
      {trend && (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            trend.direction === "up" && "text-success",
            trend.direction === "down" && "text-danger",
            trend.direction === "neutral" && "text-foreground-muted",
          )}
        >
          {trend.value}
        </p>
      )}
    </div>
  );
}
