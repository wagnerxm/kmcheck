import { Scale } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Comparador de Odds | BetEdge" };

export default function OddsComparisonPage() {
  return (
    <PlaceholderPage
      title="Comparador de Odds"
      description="Compare as odds oferecidas pelas principais casas de apostas lado a lado."
      icon={Scale}
    />
  );
}
