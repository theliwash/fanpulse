import { NextResponse } from "next/server";
import type { FootballMatchSummary } from "@/lib/football-types";

const API_BASE = "https://api.football-data.org/v4";
const CACHE_SECONDS = 60;

type FootballDataTeam = {
  name: string | null;
};

type FootballDataScore = {
  fullTime?: {
    home: number | null;
    away: number | null;
  };
};

type FootballDataMatch = {
  id: number;
  status: string;
  utcDate: string;
  homeTeam: FootballDataTeam;
  awayTeam: FootballDataTeam;
  score?: FootballDataScore;
};

type FootballDataMatchesResponse = {
  matches?: FootballDataMatch[];
};

function getApiKey(): string | undefined {
  return process.env.FOOTBALL_DATA_API_KEY;
}

function simplifyMatch(match: FootballDataMatch): FootballMatchSummary {
  const fullTime = match.score?.fullTime;
  const score: FootballMatchSummary["score"] = fullTime
    ? { home: fullTime.home ?? null, away: fullTime.away ?? null }
    : null;

  return {
    id: match.id,
    homeTeam: match.homeTeam.name ?? null,
    awayTeam: match.awayTeam.name ?? null,
    status: match.status,
    score,
    utcDate: match.utcDate,
  };
}

function sortMatches(matches: FootballMatchSummary[]): FootballMatchSummary[] {
  const todayKey = new Date().toISOString().slice(0, 10);

  function rank(m: FootballMatchSummary): number {
    if (m.status === 'LIVE' || m.status === 'IN_PLAY') return 0;
    if (m.status === 'FINISHED' && m.utcDate.slice(0, 10) === todayKey) return 1;
    return 2;
  }

  return [...matches].sort((a, b) => {
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    return new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime();
  });
}

export async function GET() {
  const apiKey = getApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "FOOTBALL_DATA_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    const url = `${API_BASE}/competitions/WC/matches`;
    const response = await fetch(url, {
      headers: { "X-Auth-Token": apiKey },
      next: { revalidate: CACHE_SECONDS },
    });

    if (!response.ok) {
      throw new Error(`football-data.org returned ${response.status}`);
    }

    const data = (await response.json()) as FootballDataMatchesResponse;
    const matches = (data.matches ?? []).map(simplifyMatch);

    return NextResponse.json(sortMatches(matches));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch matches";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
