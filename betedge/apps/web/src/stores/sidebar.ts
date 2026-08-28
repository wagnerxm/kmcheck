import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Estado global (Zustand) do menu lateral: se está recolhido (modo compacto,
 * só ícones) e se a gaveta mobile está aberta. Persistido em localStorage
 * para lembrar a preferência do usuário entre sessões.
 */
interface SidebarState {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setMobileOpen: (open: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isCollapsed: false,
      isMobileOpen: false,
      toggleCollapsed: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
      setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),
      setMobileOpen: (open) => set({ isMobileOpen: open }),
    }),
    {
      name: "betedge-sidebar",
      // A gaveta mobile nunca deve persistir aberta entre sessões.
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
    },
  ),
);
