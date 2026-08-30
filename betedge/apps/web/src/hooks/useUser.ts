"use client";

import { useAuthContext } from "@/lib/providers";

/**
 * Hook de conveniência para acessar o usuário autenticado atual (Supabase)
 * em qualquer componente client-side dentro de `<Providers>`.
 *
 * Ex.: const { user, isLoading, isAuthenticated } = useUser();
 */
export function useUser() {
  const { user, isLoading } = useAuthContext();

  return {
    user,
    isLoading,
    isAuthenticated: !isLoading && user !== null,
  };
}
