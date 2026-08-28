import { cn } from "@/lib/utils";

/** Placeholder de carregamento com efeito "shimmer" — ver `.skeleton` em globals.css. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} {...props} />;
}

export { Skeleton };
