import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Página placeholder padrão para rotas ainda não implementadas. Usada em
 * todas as seções do app que ainda não têm funcionalidade real na Fase 0.
 */
export function PlaceholderPage({ title, description, icon: Icon }: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="mt-1 text-sm text-foreground-subtle">{description}</p>
        </div>
        <Badge variant="secondary">Em desenvolvimento</Badge>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Icon className="h-7 w-7 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">
            Esta funcionalidade está em desenvolvimento
          </p>
          <p className="max-w-sm text-xs text-foreground-subtle">
            Estamos trabalhando para trazer esta seção em breve. Volte mais tarde para
            conferir as novidades.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
