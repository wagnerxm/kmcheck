import { BarChart3 } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Estatísticas | BetEdge" };

export default function EstatisticasPage() {
  return (
    <PlaceholderPage
      title="Estatísticas"
      description="Estatísticas detalhadas de times, jogadores e campeonatos."
      icon={BarChart3}
    />
  );
}
