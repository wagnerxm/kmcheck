import { Trophy } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Campeonatos | BetEdge" };

export default function CampeonatosPage() {
  return (
    <PlaceholderPage
      title="Campeonatos"
      description="Todos os campeonatos e temporadas cobertos pela plataforma."
      icon={Trophy}
    />
  );
}
