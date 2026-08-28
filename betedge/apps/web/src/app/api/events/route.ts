/**
 * GET /api/events
 *
 * Lista eventos agendados/ao vivo com dados de time e liga, ordenados por
 * horário de kickoff. Usado pelo seletor de jogos no Comparador de Odds.
 *
 * Query params:
 *  - status: "scheduled" | "live" | "finished" (padrão: "scheduled,live")
 *  - leagueId: filtrar por liga (opcional)
 *  - limit: máximo de resultados (padrão: 30)
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status") ?? "scheduled,live";
  const leagueId = searchParams.get("leagueId");
  const limit = Math.min(Number(searchParams.get("limit") ?? 30), 100);

  const statuses = statusParam.split(",").map((s) => s.trim());

  const supabase = await createClient();

  let query = supabase
    .from("events")
    .select(`
      id,
      kickoff_at,
      status,
      home_score,
      away_score,
      round,
      venue_name,
      home_team:teams!home_team_id ( id, name, short_name ),
      away_team:teams!away_team_id ( id, name, short_name ),
      league:leagues!league_id ( id, name, short_name, country_code )
    `)
    .in("status", statuses)
    .order("kickoff_at", { ascending: true })
    .limit(limit);

  if (leagueId) {
    query = query.eq("league_id", leagueId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Falha ao buscar eventos", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ events: data ?? [] });
}
