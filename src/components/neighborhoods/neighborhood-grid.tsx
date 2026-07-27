import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

const neighborhoods = [
  {
    slug: "sicardi",
    name: "Sicardi",
    description: "Barrio residencial con comercios de cercanía",
    emoji: "🏘️",
  },
  {
    slug: "garibaldi",
    name: "Garibaldi",
    description: "Zona céntrica con servicios y gastronomía",
    emoji: "🏪",
  },
  {
    slug: "arana",
    name: "Arana",
    description: "Comunidad activa con oferta de mano de obra",
    emoji: "🔧",
  },
  {
    slug: "correas",
    name: "Correas",
    description: "Barrio en crecimiento con nuevos servicios",
    emoji: "🌱",
  },
];

export function NeighborhoodGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {neighborhoods.map((n) => (
        <Link key={n.slug} href={`/products?barrio=${n.slug}`}>
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6 text-center">
              <span className="text-4xl mb-3 block">{n.emoji}</span>
              <h3 className="font-semibold text-lg">{n.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{n.description}</p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}