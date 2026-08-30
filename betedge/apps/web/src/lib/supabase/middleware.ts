import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Prefixos de rota que exigem usuário autenticado. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/top-picks",
  "/value-finder",
  "/odds-scanner",
  "/line-movement",
  "/odds-comparison",
  "/ai-analyst",
  "/jogos",
  "/campeonatos",
  "/estatisticas",
  "/model-lab",
  "/performance",
  "/favoritos",
  "/alertas",
  "/configuracoes",
];

/** Rotas de autenticação — usuário já logado é redirecionado para o dashboard. */
const AUTH_PREFIXES = ["/login", "/cadastro", "/recuperar-senha"];

/**
 * Renova a sessão do Supabase a cada requisição e protege as rotas internas
 * do app. Precisa rodar no middleware (não em Server Components) porque é o
 * único ponto em que conseguimos reescrever a resposta antes do render.
 *
 * Referência: https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Precisa aplicar os cookies tanto na request (para que o restante
          // do pipeline do Next enxergue a sessão atualizada) quanto na
          // response (para que o browser efetivamente os receba).
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: não remover este `getUser()`. É ele quem de fato valida o
  // token com o servidor Supabase (getSession() sozinho apenas lê o cookie,
  // sem revalidar) e dispara a renovação do token quando necessário.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isProtectedRoute = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isAuthRoute = AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!user && isProtectedRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && isAuthRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.searchParams.delete("redirectTo");
    return NextResponse.redirect(redirectUrl);
  }

  // IMPORTANTE: sempre retornar o `supabaseResponse` (ou um NextResponse
  // criado a partir dele) mantendo os cookies — criar uma resposta nova do
  // zero aqui derrubaria a sessão do usuário silenciosamente.
  return supabaseResponse;
}
