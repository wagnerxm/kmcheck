import { Target, CalendarCheck, Radar, Building2, ArrowRight } from "lucide-react";
import { StatCard } from "@/components/layout/stat-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Dashboard | BetEdge",
};

/**
 * Dashboard principal — visão consolidada do dia: oportunidades detectadas,
 * volume de dados monitorados e atalhos para as demais áreas da plataforma.
 *
 * Fase 0: página esqueleto com estados vazios/skeleton. A integração com o
 * motor estatístico (FastAPI) e os dados reais de odds virão nas próximas fases.
 */
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-foreground-subtle">
          Visão geral das oportunidades e dados monitorados pela plataforma.
        </p>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Oportunidades Hoje" value="—" icon={Target} isLoading />
        <StatCard label="Jogos Analisados" value="—" icon={CalendarCheck} isLoading />
        <StatCard label="Odds Monitoradas" value="—" icon={Radar} isLoading />
        <StatCard label="Casas de Apostas" value="—" icon={Building2} isLoading />
      </div>

      {/* Seções principais */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlaceholderSection
          title="Top Oportunidades"
          description="Melhores oportunidades de valor detectadas pelo motor estatístico."
          emptyMessage="Nenhuma oportunidade calculada ainda. Assim que o motor estatístico for conectado, as melhores oportunidades do dia aparecerão aqui."
        />
        <PlaceholderSection
          title="Movimentos Recentes"
          description="Variações relevantes de linha nas últimas horas."
          emptyMessage="Nenhum movimento de linha registrado ainda."
        />
        <PlaceholderSection
          title="Próximos Jogos"
          description="Jogos com apito inicial nas próximas horas."
          emptyMessage="Nenhum jogo carregado. Conecte uma fonte de dados de eventos para começar."
        />
        <PlaceholderSection
          title="Performance dos Modelos"
          description="Precisão histórica dos modelos estatísticos por esporte."
          emptyMessage="Ainda não há histórico suficiente para calcular a performance dos modelos."
        />
      </div>
    </div>
  );
}

function PlaceholderSection({
  title,
  description,
  emptyMessage,
}: {
  title: string;
  description: string;
  emptyMessage: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-foreground text-base font-semibold">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-foreground-subtle" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-4/5" />
        </div>
        <p className="pt-1 text-xs text-foreground-subtle">{emptyMessage}</p>
      </CardContent>
    </Card>
  );
}
