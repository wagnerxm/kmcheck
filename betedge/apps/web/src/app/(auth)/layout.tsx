/**
 * Layout compartilhado das páginas de autenticação: cartão centralizado sobre
 * fundo escuro com o logo da plataforma acima do formulário.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <span className="font-display text-2xl font-bold uppercase tracking-tight text-foreground">
          PREDIQ
        </span>
      </div>

      <div className="w-full max-w-md card-premium p-8">{children}</div>

      <p className="mt-8 max-w-sm text-center text-xs text-foreground-subtle">
        Previsões são probabilísticas. Desempenho passado não garante resultado futuro.
      </p>
    </div>
  );
}
