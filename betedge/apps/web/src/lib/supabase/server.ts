import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente Supabase para uso em Server Components, Server Actions e Route
 * Handlers. Lê/escreve os cookies de sessão via a API `cookies()` do Next.js
 * para manter a autenticação sincronizada entre servidor e cliente.
 *
 * IMPORTANTE: `set`/`remove` podem lançar erro quando chamados dentro de um
 * Server Component puro (que não pode alterar cookies) — o try/catch é
 * intencional e seguro: nesses casos o middleware já cuida do refresh da
 * sessão a cada requisição.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Chamado a partir de um Server Component — ignorado com segurança,
            // pois o middleware já renova a sessão em toda requisição.
          }
        },
      },
    },
  );
}
