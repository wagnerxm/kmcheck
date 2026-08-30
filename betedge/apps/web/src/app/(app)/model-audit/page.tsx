import { Shield } from "lucide-react";
import { ModelAuditClient } from "./client";

export const metadata = { title: "Model Audit | BetEdge" };

/**
 * Página de Auditoria de Modelos — Server Component que monta o cabeçalho
 * e delega toda a lógica interativa para o Client Component.
 */
export default function ModelAuditPage() {
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
            <Shield className="h-5 w-5 text-primary-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Model Audit — Validacao Quantitativa
            </h1>
            <p className="text-sm text-foreground-subtle">
              Auditoria completa do pipeline de previsoes. Todos os dados sao rastreaveis e reproduziveis.
            </p>
          </div>
        </div>
      </div>

      {/* Conteudo interativo */}
      <ModelAuditClient />
    </div>
  );
}
