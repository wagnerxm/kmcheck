import { DashboardClient } from "./client";

export const metadata = {
  title: "PREDIQ — Oportunidades",
};

/**
 * Dashboard principal — Tela de oportunidades do PREDIQ.
 * Server component fino que delega toda a interatividade ao client component.
 */
export default function DashboardPage() {
  return <DashboardClient />;
}
