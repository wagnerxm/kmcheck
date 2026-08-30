"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente Supabase para uso no browser (componentes client-side).
 * Usa a chave anônima (`anon key`) — segura para expor ao cliente, pois todo
 * acesso a dados é controlado por Row Level Security (RLS) no Postgres.
 *
 * Criar uma única instância por módulo evita reconexões desnecessárias entre
 * re-renderizações de componentes.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
