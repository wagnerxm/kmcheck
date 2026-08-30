import { redirect } from "next/navigation";

/**
 * A raiz do site apenas redireciona: usuários autenticados são levados ao
 * dashboard e visitantes ao login — o middleware decide o destino final
 * (ambas as rotas passam pelas checagens de autenticação).
 */
export default function RootPage() {
  redirect("/dashboard");
}
