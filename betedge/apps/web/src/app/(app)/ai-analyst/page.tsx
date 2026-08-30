import { Sparkles } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Analista IA | BetEdge" };

export default function AiAnalystPage() {
  return (
    <PlaceholderPage
      title="Analista IA"
      description="Converse com o analista de IA para entender o raciocínio por trás de cada previsão."
      icon={Sparkles}
    />
  );
}
