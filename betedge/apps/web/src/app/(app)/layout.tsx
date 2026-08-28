import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * Layout do "shell" principal do app (rotas autenticadas): sidebar fixa à
 * esquerda em desktop / gaveta em mobile, barra superior e área de conteúdo.
 * A checagem de autenticação em si acontece no middleware (`src/middleware.ts`);
 * este layout assume que só é renderizado para usuários já logados.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />

        <main className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>

        <footer className="border-t border-card-border/50 px-4 py-4 text-center text-xs text-foreground-subtle lg:px-6">
          Previsões são probabilísticas. Desempenho passado não garante resultado futuro.
        </footer>
      </div>
    </div>
  );
}
