"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Contexto de autenticação: expõe o usuário Supabase atual (ou `null`) para
 * toda a árvore de componentes client-side, sem precisar re-consultar a
 * sessão em cada componente. É atualizado automaticamente via
 * `onAuthStateChange` (login, logout, refresh de token).
 */
interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({ user: null, isLoading: true });

export function useAuthContext() {
  return useContext(AuthContext);
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading }}>{children}</AuthContext.Provider>
  );
}

/**
 * Provedor raiz da aplicação: React Query (cache de dados assíncronos, como
 * eventos/odds/previsões vindos da API) + contexto de autenticação Supabase.
 * Uma única instância de `QueryClient` por sessão do browser, criada dentro
 * do `useState` para não ser recriada a cada re-render.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Dados de odds/mercado mudam com frequência — um staleTime curto
            // evita requisições excessivas sem deixar a tela "velha" por muito tempo.
            staleTime: 30 * 1000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
