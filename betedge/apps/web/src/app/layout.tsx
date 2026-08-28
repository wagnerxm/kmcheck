import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/lib/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BetEdge — Inteligência Estatística para Apostas Esportivas",
  description:
    "Plataforma de análise quantitativa de odds esportivas: previsões estatísticas, detecção de valor e comparação de casas de apostas em tempo real.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Dark mode é o padrão da plataforma — um dashboard quantitativo, não um cassino.
    <html lang="pt-BR" className="dark">
      <body className={`${inter.variable} font-sans min-h-screen`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
