import { TrendingUp } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Value Finder | BetEdge" };

export default function ValueFinderPage() {
  return (
    <PlaceholderPage
      title="Value Finder"
      description="Busque oportunidades de valor comparando odds de mercado com as probabilidades do modelo."
      icon={TrendingUp}
    />
  );
}
