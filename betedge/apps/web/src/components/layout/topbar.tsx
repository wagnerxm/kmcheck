"use client";

import { Bell, Menu, Search } from "lucide-react";
import { useSidebarStore } from "@/stores/sidebar";
import { Input } from "@/components/ui/input";

/**
 * Barra superior fixa: botão de menu (mobile), busca global e sino de
 * notificações. Fica acima do conteúdo de cada página do app.
 */
export function Topbar() {
  const { setMobileOpen } = useSidebarStore();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-card-border/50 bg-background/80 px-4 backdrop-blur-xl lg:px-6">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted hover:bg-card/60 lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative hidden max-w-sm flex-1 sm:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
        <Input
          type="search"
          placeholder="Buscar jogos, times ou campeonatos..."
          className="pl-9"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-card/60 hover:text-foreground"
          aria-label="Notificações"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary" />
        </button>
      </div>
    </header>
  );
}
