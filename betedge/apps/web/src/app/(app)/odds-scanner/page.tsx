import { Radar } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Odds Scanner | BetEdge" };

export default function OddsScannerPage() {
  return (
    <PlaceholderPage
      title="Odds Scanner"
      description="Varredura em tempo real das odds monitoradas em todas as casas de apostas."
      icon={Radar}
    />
  );
}
