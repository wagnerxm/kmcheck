"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Target, Scale, BarChart3, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard",     label: "Início",        icon: Home },
  { href: "/top-picks",     label: "Oportunidades", icon: Target },
  { href: "/odds-comparison", label: "Odds",         icon: Scale },
  { href: "/model-audit",   label: "Análises",      icon: BarChart3 },
  { href: "/configuracoes", label: "Perfil",         icon: User },
];

/**
 * Barra de navegação inferior fixa para mobile.
 * 5 itens com ícone + rótulo, item ativo em vermelho.
 * Oculta em desktop (lg:hidden). Respeita safe-area para
 * dispositivos com home indicator (iPhone etc.).
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-card-border/40 bg-background-surface/95 backdrop-blur-xl lg:hidden"
      aria-label="Navegação principal"
    >
      <div className="flex items-center justify-around pb-safe">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 pt-2 transition-colors",
                isActive ? "text-primary" : "text-foreground-subtle",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
