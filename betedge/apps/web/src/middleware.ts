import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * NOTA: o middleware do Next.js precisa ficar em `src/middleware.ts` (raiz do
 * diretório `src`, no mesmo nível de `app/`) — colocá-lo dentro de `src/app/`
 * faz o Next.js simplesmente ignorá-lo. A lógica em si vive em
 * `lib/supabase/middleware.ts` para manter este arquivo só como o "entry point".
 */
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Roda em todas as rotas exceto assets estáticos e arquivos internos do
     * Next.js, para não desperdiçar a renovação de sessão em requisições que
     * não precisam dela.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
