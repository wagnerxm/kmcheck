import { Activity } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Movimento de Linha | BetEdge" };

export default function LineMovementPage() {
  return (
    <PlaceholderPage
      title="Movimento de Linha"
      description="Acompanhe a variação das odds ao longo do tempo para identificar movimentos de mercado."
      icon={Activity}
    />
  );
}
