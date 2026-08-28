import { Settings } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Configurações | BetEdge" };

export default function ConfiguracoesPage() {
  return (
    <PlaceholderPage
      title="Configurações"
      description="Preferências da conta, notificações e integração com casas de apostas."
      icon={Settings}
    />
  );
}
