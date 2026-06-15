import { NextResponse } from "next/server";
import type { FootballMatchSummary } from "@/lib/football-types";

async function parseApiError(response: Response): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string"
  ) {
    return (data as { error: string }).error;
  }
  return `Request failed (${response.status})`;
}

export async function GET() {
  try {
    const matchesRes = await fetch(
      `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/football/matches`,
      { cache: "no-store" }
    );
    if (!matchesRes.ok) {
      throw new Error(await parseApiError(matchesRes));
    }

    const matches: unknown = await matchesRes.json();
    if (!Array.isArray(matches)) {
      throw new Error("Invalid matches response");
    }

    const liveMatches = (matches as FootballMatchSummary[]).filter(
      (m) => m.status === "LIVE" || m.status === "IN_PLAY"
    );

    let processedCount = 0;
    let errorCount = 0;

    for (const match of liveMatches) {
      try {
        const matchId = match.id;

        // Fetch match events
        const eventsRes = await fetch(
          `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/football/match-events?match_id=${matchId}`,
          { cache: "no-store" }
        );
        if (!eventsRes.ok) {
          throw new Error(await parseApiError(eventsRes));
        }

        const eventsData: unknown = await eventsRes.json();
        let status: string | undefined;
        let goals: unknown;
        let homeScore: number | null = null;
        let awayScore: number | null = null;
        if (typeof eventsData === "object" && eventsData !== null) {
          status = (eventsData as { status?: unknown }).status as string | undefined;
          goals = (eventsData as { goals?: unknown }).goals;
          const hs = (eventsData as { homeScore?: unknown }).homeScore;
          const as = (eventsData as { awayScore?: unknown }).awayScore;
          homeScore = typeof hs === "number" ? hs : null;
          awayScore = typeof as === "number" ? as : null;
        }

        // Fetch emoji counts for this match
        let emojiCounts = { fire: 0, shocked: 0, sad: 0, angry: 0, party: 0 };
        try {
          const emojiRes = await fetch(
            `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/reactions/emoji?matchId=${String(matchId)}`,
            { cache: "no-store" }
          );
          if (emojiRes.ok) {
            emojiCounts = await emojiRes.json();
          }
        } catch (err) {
          console.error(`Failed to fetch emoji counts for match ${matchId}:`, err);
        }

        // Post to sentiment analysis
        const analyzeRes = await fetch(
          `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/sentiment/analyze`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              matchId: String(matchId),
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
              status: status ?? "",
              goals: Array.isArray(goals) ? goals : [],
              userReactions: [],
              homeScore,
              awayScore,
              emojiCounts,
            }),
            cache: "no-store",
          }
        );

        if (!analyzeRes.ok) {
          throw new Error(await parseApiError(analyzeRes));
        }

        processedCount++;
      } catch (err) {
        console.error(`Error processing match ${match.id}:`, err);
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      liveMatches: liveMatches.length,
      processed: processedCount,
      errors: errorCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process sentiment";
    console.error("Cron sentiment error:", message);
    return NextResponse.json(
      { error: message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
