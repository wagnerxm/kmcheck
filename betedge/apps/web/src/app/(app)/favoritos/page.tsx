import { Star } from "lucide-react";
import { PlaceholderPage } from "@/components/layout/placeholder-page";

export const metadata = { title: "Favoritos | BetEdge" };

export default function FavoritosPage() {
  return (
    <PlaceholderPage
      title="Favoritos"
      description="Times, campeonatos e mercados que você marcou como favoritos."
      icon={Star}
    />
  );
}
