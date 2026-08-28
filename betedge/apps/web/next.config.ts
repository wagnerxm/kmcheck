import type { NextConfig } from "next";

/**
 * Configuração do Next.js para o app web do BetEdge.
 * `transpilePackages` é necessário porque os pacotes internos do monorepo
 * (@betedge/types, @betedge/utils) são publicados como TypeScript puro,
 * sem etapa de build própria — o Next.js compila-os junto com o app.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@betedge/types", "@betedge/utils"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
