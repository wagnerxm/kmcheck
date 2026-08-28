import { Target } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Top Picks | BetEdge" };

export default function TopPicksPage() {
  return (
    <PlaceholderPage
      title="Top Picks"
      description="As apostas com maior nota de EdgeScore selecionadas pelo motor estatístico."
      icon={Target}
    />
  );
}
