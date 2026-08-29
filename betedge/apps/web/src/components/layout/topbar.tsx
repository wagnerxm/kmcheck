"use client";

import { Bell, Bookmark, Menu } from "lucide-react";
import { useSidebarStore } from "@/stores/sidebar";

/**
 * Barra superior fixa: botão de menu (mobile), logo PREDIQ, favoritos e sino
 * de notificações. Fica acima do conteúdo de cada página do app.
 */
export function Topbar() {
  const { setMobileOpen } = useSidebarStore();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-card-border/30 bg-background/90 px-4 backdrop-blur-xl lg:h-16 lg:px-6">
      {/* Hambúrguer mobile */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted hover:bg-card/60 lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Logo PREDIQ */}
      <div className="flex items-center gap-2">
        <span className="font-display text-lg font-bold tracking-tight text-foreground">
          PREDIQ
        </span>
        <span className="hidden rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary sm:inline-block">
          Pro
        </span>
      </div>

      {/* Espaçador */}
      <div className="flex-1" />

      {/* Ações */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-card/60 hover:text-foreground"
          aria-label="Favoritos"
        >
          <Bookmark className="h-[18px] w-[18px]" />
        </button>
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
