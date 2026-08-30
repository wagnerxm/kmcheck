import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Variação percentual/textual exibida abaixo do valor, ex.: "+12% vs. ontem". */
  trend?: {
    value: string;
    direction: "up" | "down" | "neutral";
  };
  /** Exibe um estado de carregamento (skeleton) no lugar do valor. */
  isLoading?: boolean;
}

/** Cartão de métrica usado nas linhas de KPIs do dashboard. */
export function StatCard({ label, value, icon: Icon, trend, isLoading }: StatCardProps) {
  return (
    <Card className="transition-colors hover:border-card-border">
      <CardContent className="flex items-start justify-between p-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground-subtle">{label}</p>
          {isLoading ? (
            <div className="skeleton h-7 w-16" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
          )}
          {trend && !isLoading && (
            <p
              className={cn(
                "text-xs font-medium",
                trend.direction === "up" && "text-success",
                trend.direction === "down" && "text-danger",
                trend.direction === "neutral" && "text-foreground-subtle",
              )}
            >
              {trend.value}
            </p>
          )}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-[18px] w-[18px] text-primary" />
        </div>
      </CardContent>
    </Card>
  );
}
