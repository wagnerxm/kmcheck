import { TrendingUp } from "lucide-react";

/**
 * Layout compartilhado das páginas de autenticação: cartão centralizado sobre
 * um fundo escuro com o logo da plataforma acima do formulário.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <TrendingUp className="h-5 w-5 text-primary-400" />
        </div>
        <span className="text-xl font-semibold tracking-tight text-foreground">
          Bet<span className="text-primary-400">Edge</span>
        </span>
      </div>

      <div className="w-full max-w-md glass rounded-2xl p-8 shadow-glass">{children}</div>

      <p className="mt-8 max-w-sm text-center text-xs text-foreground-subtle">
        Previsões são probabilísticas. Desempenho passado não garante resultado futuro.
      </p>
    </div>
  );
}
