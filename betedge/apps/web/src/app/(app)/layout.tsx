import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";

/**
 * Layout do "shell" principal do app (rotas autenticadas): sidebar fixa à
 * esquerda em desktop / gaveta em mobile, barra superior, área de conteúdo e
 * navegação inferior mobile. A checagem de autenticação em si acontece no
 * middleware (`src/middleware.ts`); este layout assume que só é renderizado
 * para usuários já logados.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-4 py-4 pb-24 lg:px-6 lg:py-6 lg:pb-6">
          <div className="mx-auto lg:max-w-7xl">{children}</div>
        </main>
        <footer className="hidden border-t border-card-border/30 px-4 py-4 text-center text-xs text-foreground-subtle lg:block lg:px-6">
          Previsões são probabilísticas. Desempenho passado não garante resultado futuro.
        </footer>
      </div>
      <BottomNav />
    </div>
  );
}
