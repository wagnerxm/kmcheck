import { FlaskConical } from "lucide-react";
import { ShadowLabClient } from "./client";

export const metadata = { title: "Shadow Lab | BetEdge" };

/**
 * Shadow Lab — Server Component que monta o cabecalho e delega
 * toda a logica interativa para o Client Component.
 */
export default function ShadowLabPage() {
  return (
    <div className="space-y-6">
      {/* Cabecalho */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <FlaskConical className="h-5 w-5 text-primary-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Shadow Lab — Validacao Prospectiva
            </h1>
            <p className="text-sm text-foreground-subtle">
              Operacao em shadow mode: previsoes simuladas sem dinheiro real. Avaliacao continua de qualidade.
            </p>
          </div>
        </div>
      </div>

      {/* Conteudo interativo */}
      <ShadowLabClient />
    </div>
  );
}
