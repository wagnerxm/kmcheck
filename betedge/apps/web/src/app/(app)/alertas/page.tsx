import { Bell } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Alertas | BetEdge" };

export default function AlertasPage() {
  return (
    <PlaceholderPage
      title="Alertas"
      description="Configure alertas para ser avisado sobre novas oportunidades e movimentos de linha."
      icon={Bell}
    />
  );
}
