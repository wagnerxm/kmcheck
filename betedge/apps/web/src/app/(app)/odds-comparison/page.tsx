import { Scale } from "lucide-react";
import { OddsComparisonClient } from "./client";

export const metadata = { title: "Comparador de Odds | BetEdge" };

/**
 * Página do Comparador de Odds — Server Component que apenas monta o
 * cabeçalho e delega a lógica interativa para o Client Component.
 */
export default function OddsComparisonPage() {
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Scale className="h-5 w-5 text-primary-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Comparador de Odds
            </h1>
            <p className="text-sm text-foreground-subtle">
              Compare as cotações das principais casas lado a lado
            </p>
          </div>
        </div>
      </div>

      {/* Conteúdo interativo */}
      <OddsComparisonClient />
    </div>
  );
}
