"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Target,
  TrendingUp,
  Radar,
  Activity,
  Scale,
  Sparkles,
  CalendarDays,
  Trophy,
  BarChart3,
  FlaskConical,
  LineChart,
  Shield,
  Star,
  Bell,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/stores/sidebar";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";

/** Item de navegação da sidebar: rótulo em pt-BR, rota e ícone Lucide. */
interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Seções de navegação — agrupadas para facilitar a leitura visual do menu. */
const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Visão geral",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Oportunidades",
    items: [
      { label: "Top Picks", href: "/top-picks", icon: Target },
      { label: "Value Finder", href: "/value-finder", icon: TrendingUp },
      { label: "Odds Scanner", href: "/odds-scanner", icon: Radar },
      { label: "Movimento de Linha", href: "/line-movement", icon: Activity },
      { label: "Comparador de Odds", href: "/odds-comparison", icon: Scale },
      { label: "Analista IA", href: "/ai-analyst", icon: Sparkles },
    ],
  },
  {
    title: "Dados",
    items: [
      { label: "Jogos", href: "/jogos", icon: CalendarDays },
      { label: "Campeonatos", href: "/campeonatos", icon: Trophy },
      { label: "Estatísticas", href: "/estatisticas", icon: BarChart3 },
    ],
  },
  {
    title: "Modelos",
    items: [
      { label: "Model Lab", href: "/model-lab", icon: FlaskConical },
      { label: "Performance", href: "/performance", icon: LineChart },
      { label: "Model Audit", href: "/model-audit", icon: Shield },
    ],
  },
  {
    title: "Minha conta",
    items: [
      { label: "Favoritos", href: "/favoritos", icon: Star },
      { label: "Alertas", href: "/alertas", icon: Bell },
      { label: "Configurações", href: "/configuracoes", icon: Settings },
    ],
  },
];

function NavLink({
  item,
  isCollapsed,
  isActive,
  onNavigate,
}: {
  item: NavItem;
  isCollapsed: boolean;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={isCollapsed ? item.label : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary/10 text-primary-400 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.25)]"
          : "text-foreground-muted hover:bg-card/60 hover:text-foreground",
        isCollapsed && "justify-center px-2",
      )}
    >
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0",
          isActive ? "text-primary-400" : "text-foreground-subtle group-hover:text-foreground",
        )}
      />
      {!isCollapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/** Conteúdo interno da sidebar, compartilhado entre a versão desktop e a gaveta mobile. */
function SidebarContent({
  isCollapsed,
  onNavigate,
}: {
  isCollapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { user } = useUser();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initial = (user?.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2 px-4",
          isCollapsed && "justify-center px-2",
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          <TrendingUp className="h-[18px] w-[18px] text-primary-400" />
        </div>
        {!isCollapsed && (
          <span className="text-base font-semibold tracking-tight text-foreground">
            Bet<span className="text-primary-400">Edge</span>
          </span>
        )}
      </div>

      <Separator />

      {/* Navegação */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            {!isCollapsed && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  isCollapsed={isCollapsed}
                  isActive={pathname === item.href || pathname?.startsWith(item.href + "/")}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <Separator />

      {/* Rodapé: usuário + logout */}
      <div className={cn("flex items-center gap-2 p-3", isCollapsed && "flex-col")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary-400">
          {initial}
        </div>
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {user?.email ?? "Carregando..."}
            </p>
            <p className="text-xs text-foreground-subtle">Plano gratuito</p>
          </div>
        )}
        <button
          type="button"
          onClick={handleLogout}
          title="Sair"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-subtle transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Separator() {
  return <div className="h-px w-full bg-card-border/50" />;
}

/** Sidebar de navegação principal: fixa em desktop, gaveta sobreposta em mobile. */
export function Sidebar() {
  const { isCollapsed, toggleCollapsed, isMobileOpen, setMobileOpen } = useSidebarStore();

  return (
    <>
      {/* Desktop: coluna fixa, recolhível entre 240px e 72px. */}
      <aside
        className={cn(
          "relative hidden shrink-0 border-r border-card-border/50 bg-background-surface/60 backdrop-blur-xl transition-all duration-200 lg:flex",
          isCollapsed ? "w-[72px]" : "w-[240px]",
        )}
      >
        <SidebarContent isCollapsed={isCollapsed} />
        <button
          type="button"
          onClick={toggleCollapsed}
          title={isCollapsed ? "Expandir menu" : "Recolher menu"}
          className="absolute -right-3 top-16 flex h-6 w-6 items-center justify-center rounded-full border border-card-border bg-background-surface text-foreground-subtle shadow-glass transition-colors hover:text-foreground"
        >
          {isCollapsed ? (
            <ChevronsRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronsLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {/* Mobile: gaveta sobreposta com fundo escurecido. */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[260px] border-r border-card-border/50 bg-background-surface shadow-glass animate-fade-in">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle hover:bg-card/60 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent isCollapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
    </>
  );
}
