import { FlaskConical } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Model Lab | BetEdge" };

export default function ModelLabPage() {
  return (
    <PlaceholderPage
      title="Model Lab"
      description="Ambiente para explorar, comparar e ajustar os modelos estatísticos da plataforma."
      icon={FlaskConical}
    />
  );
}
