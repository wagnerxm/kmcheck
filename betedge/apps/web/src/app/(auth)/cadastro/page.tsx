"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Lock, Mail, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Página de cadastro (criação de conta) via Supabase Auth. */
export default function CadastroPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setIsLoading(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    setIsLoading(false);

    if (signUpError) {
      setError(traduzirErroAuth(signUpError.message));
      return;
    }

    setIsSuccess(true);
  }

  if (isSuccess) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
          <CheckCircle2 className="h-6 w-6 text-primary-400" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Confirme seu e-mail</h1>
        <p className="text-sm text-foreground-subtle">
          Enviamos um link de confirmação para <span className="text-foreground">{email}</span>.
          Clique no link para ativar sua conta e fazer login.
        </p>
        <Link href="/login">
          <Button variant="secondary" className="w-full">
            Voltar para o login
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold text-foreground">Criar conta</h1>
        <p className="text-sm text-foreground-subtle">
          Comece a acompanhar oportunidades de valor em segundos.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="fullName" className="text-xs font-medium text-foreground-muted">
            Nome completo
          </label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              id="fullName"
              type="text"
              autoComplete="name"
              placeholder="Seu nome"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-xs font-medium text-foreground-muted">
            E-mail
          </label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="voce@exemplo.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium text-foreground-muted">
            Senha
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Mínimo de 6 caracteres"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar conta
        </Button>
      </form>

      <p className="text-center text-sm text-foreground-subtle">
        Já tem uma conta?{" "}
        <Link href="/login" className="font-medium text-primary-400 hover:underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

function traduzirErroAuth(message: string): string {
  const mapa: Record<string, string> = {
    "User already registered": "Já existe uma conta com este e-mail.",
    "Password should be at least 6 characters": "A senha deve ter pelo menos 6 caracteres.",
  };
  return mapa[message] ?? "Não foi possível criar a conta. Tente novamente.";
}
