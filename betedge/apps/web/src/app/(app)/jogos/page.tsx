import { CalendarDays } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Jogos | BetEdge" };

export default function JogosPage() {
  return (
    <PlaceholderPage
      title="Jogos"
      description="Lista completa de jogos monitorados, com filtros por esporte, campeonato e data."
      icon={CalendarDays}
    />
  );
}
