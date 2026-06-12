import { NextRequest, NextResponse } from "next/server";
import type { MatchEventsResponse, MatchGoalEvent } from "@/lib/football-types";

const API_BASE = "https://api.football-data.org/v4";

type FootballDataGoal = {
  minute: number;
  team: { name: string };
  scorer: { name: string };
};

type FootballDataMatchDetail = {
  status: string;
  utcDate: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  score?: {
    fullTime?: { home: number | null; away: number | null };
  };
  goals?: FootballDataGoal[];
};

export async function GET(request: NextRequest) {
  const matchId = request.nextUrl.searchParams.get("match_id");

  if (!matchId?.trim()) {
    return NextResponse.json(
      { error: "Missing required query parameter: match_id" },
      { status: 400 }
    );
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "FOOTBALL_DATA_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const url = `${API_BASE}/matches/${encodeURIComponent(matchId.trim())}`;

  try {
    const response = await fetch(url, {
      headers: { "X-Auth-Token": apiKey },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `football-data.org returned ${response.status}` },
        { status: response.status }
      );
    }

    const match = (await response.json()) as FootballDataMatchDetail;

    const goals: MatchGoalEvent[] = (match.goals ?? []).map((goal) => ({
      minute: goal.minute,
      scorer: goal.scorer.name,
      team: goal.team.name,
    }));

    const payload: MatchEventsResponse = {
      status: match.status,
      goals,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      utcDate: match.utcDate,
      homeScore: match.score?.fullTime?.home ?? null,
      awayScore: match.score?.fullTime?.away ?? null,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch match events";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
