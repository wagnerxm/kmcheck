import { LineChart } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Performance | BetEdge" };

export default function PerformancePage() {
  return (
    <PlaceholderPage
      title="Performance"
      description="Histórico de acerto e retorno simulado dos modelos ao longo do tempo."
      icon={LineChart}
    />
  );
}
