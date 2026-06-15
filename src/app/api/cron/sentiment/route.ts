import { NextResponse } from "next/server";
import type { FootballMatchSummary } from "@/lib/football-types";
import { createServerClient } from "@/lib/supabase";

const API_BASE = "https://api.football-data.org/v4";

type FootballDataTeam = {
  name: string | null;
};

type FootballDataScore = {
  fullTime?: {
    home: number | null;
    away: number | null;
  };
};

type FootballDataGoal = {
  minute: number;
  team: { name: string };
  scorer: { name: string };
};

type FootballDataMatch = {
  id: number;
  status: string;
  utcDate: string;
  homeTeam: FootballDataTeam;
  awayTeam: FootballDataTeam;
  score?: FootballDataScore;
  goals?: FootballDataGoal[];
};

type FootballDataMatchesResponse = {
  matches?: FootballDataMatch[];
};

async function fetchAllMatches(): Promise<FootballMatchSummary[]> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error("FOOTBALL_DATA_API_KEY not configured");

  const url = `${API_BASE}/competitions/WC/matches`;
  const response = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
  });

  if (!response.ok) {
    throw new Error(`football-data.org returned ${response.status}`);
  }

  const data = (await response.json()) as FootballDataMatchesResponse;
  return (data.matches ?? []).map((match) => ({
    id: match.id,
    homeTeam: match.homeTeam.name ?? null,
    awayTeam: match.awayTeam.name ?? null,
    status: match.status,
    score: match.score?.fullTime
      ? { home: match.score.fullTime.home ?? null, away: match.score.fullTime.away ?? null }
      : null,
    utcDate: match.utcDate,
  }));
}

async function fetchMatchEvents(matchId: number) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error("FOOTBALL_DATA_API_KEY not configured");

  const url = `${API_BASE}/matches/${matchId}`;
  const response = await fetch(url, {
    headers: { "X-Auth-Token": apiKey },
  });

  if (!response.ok) {
    throw new Error(`football-data.org returned ${response.status}`);
  }

  const match = (await response.json()) as FootballDataMatch;

  const goals = (match.goals ?? []).map((goal: FootballDataGoal) => ({
    minute: goal.minute,
    scorer: goal.scorer.name,
    team: goal.team.name,
  }));

  return {
    status: match.status,
    goals,
    homeTeam: match.homeTeam.name,
    awayTeam: match.awayTeam.name,
    utcDate: match.utcDate,
    homeScore: match.score?.fullTime?.home ?? null,
    awayScore: match.score?.fullTime?.away ?? null,
  };
}

async function fetchEmojiCounts(matchId: string) {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('user_reactions')
    .select('nation')
    .eq('match_id', matchId);

  if (error) {
    console.error('Emoji query error:', error);
    return { fire: 0, shocked: 0, sad: 0, angry: 0, party: 0 };
  }

  const counts = {
    fire: 0,
    shocked: 0,
    sad: 0,
    angry: 0,
    party: 0,
  };

  if (Array.isArray(data)) {
    for (const row of data) {
      const nation = row.nation as string;
      if (nation in counts) {
        counts[nation as keyof typeof counts]++;
      }
    }
  }

  return counts;
}

interface AnalyzeSentimentPayload {
  matchId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  status: string;
  goals: unknown;
  userReactions?: unknown;
  homeScore: number | null;
  awayScore: number | null;
  emojiCounts: Record<string, number>;
}

async function analyzeSentiment(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload');
  }

  const p = payload as AnalyzeSentimentPayload;
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new Error("GROQ_API_KEY not configured");

  const { matchId, homeTeam, awayTeam, status, goals, userReactions = [], homeScore, awayScore, emojiCounts } = p;

  const goalsText = Array.isArray(goals) && goals.length > 0
    ? goals.map((g: unknown) => {
        const goal = g as { minute: number; scorer: string; team: string };
        return `${goal.minute}' - ${goal.scorer} (${goal.team})`;
      }).join(', ')
    : null;

  const scoreText = goalsText == null && homeScore != null && awayScore != null
    ? `Final score: ${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}`
    : null;

  const matchInfo = [
    `Match: ${homeTeam} vs ${awayTeam}`,
    `Status: ${status}`,
    scoreText || `Goals: ${goalsText || 'No goals yet'}`,
  ].join('\n');

  const reactionsText = Array.isArray(userReactions) && userReactions.length > 0
    ? userReactions.map((r: unknown) => {
        const reaction = r as { nation: string; reaction_text: string };
        return `${reaction.nation}: ${reaction.reaction_text}`;
      }).join('\n')
    : 'None yet';

  const emojiLine = (() => {
    if (!emojiCounts || typeof emojiCounts !== 'object') return '';
    const ec = emojiCounts as Record<string, number>;
    const hasAny = Object.values(ec).some((v) => typeof v === 'number' && v > 0);
    if (!hasAny) return '';
    return `Fan emoji reactions: 🔥 ${ec.fire ?? 0}, 😱 ${ec.shocked ?? 0}, 😭 ${ec.sad ?? 0}, 😤 ${ec.angry ?? 0}, 🎉 ${ec.party ?? 0}`;
  })();

  const promptParts = [matchInfo, `User reactions: ${reactionsText}`];
  if (emojiLine) promptParts.push(emojiLine);
  promptParts.push('\nReturn a JSON array with one object per team containing:\n- nation (string)\n- sentiment_score (integer -100 to 100)\n- mood_label (one of: Euphoric, Confident, Nervous, Frustrated, Devastated, Furious, Neutral)\n- top_emotion (single word)\n- key_talking_point (max 12 words)\n\nONLY return the JSON array. No explanation, no markdown.');

  const userPrompt = promptParts.join('\n');

  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a football fan sentiment analyst covering the 2026 FIFA World Cup. Analyse the match situation and return ONLY a valid JSON array. No explanation, no markdown, no preamble.'
        },
        {
          role: 'user',
          content: userPrompt,
        }
      ],
      temperature: 0.7,
    }),
  });

  if (!groqResponse.ok) {
    throw new Error('Groq API error');
  }

  const groqData = await groqResponse.json();
  const rawContent = groqData?.choices?.[0]?.message?.content ?? groqData?.choices?.[0]?.text ?? JSON.stringify(groqData);

  const cleaned = String(rawContent).replace(/```json|```/g, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  const candidate = first !== -1 && last !== -1 ? cleaned.slice(first, last + 1) : cleaned;
  const parsed = JSON.parse(candidate) as unknown[];

  if (!Array.isArray(parsed)) {
    throw new Error('Model output is not a JSON array');
  }

  const supabase = createServerClient();
  const rows = parsed.map((item: unknown) => {
    const sentiment = item as {
      nation: string;
      sentiment_score: number;
      mood_label: string;
      top_emotion: string;
      key_talking_point: string;
    };
    return {
      match_id: String(matchId),
      nation: sentiment.nation,
      sentiment_score: Math.max(-100, Math.min(100, Math.round(sentiment.sentiment_score))),
      mood_label: sentiment.mood_label,
      top_emotion: sentiment.top_emotion,
      key_talking_point: sentiment.key_talking_point,
      comment_count: Array.isArray(userReactions) ? userReactions.length : 0,
      source: 'reddit',
    };
  });

  const { error } = await supabase.from('sentiment_snapshots').insert(rows);
  if (error) {
    throw new Error('Failed to store sentiment snapshots');
  }
}

export async function GET() {
  try {
    const matches = await fetchAllMatches();

    const allStatuses = Array.from(new Set(matches.map((m) => m.status)));
    console.log('All match statuses found:', allStatuses);

    const liveMatches = matches.filter(
      (m) =>
        m.status === "LIVE" ||
        m.status === "IN_PLAY" ||
        m.status === "PAUSED" ||
        m.status === "HALFTIME" ||
        m.status === "EXTRA_TIME" ||
        m.status === "PENALTY" ||
        m.status === "SUSPENDED" ||
        m.status === "INTERRUPTED"
    );

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentlyFinishedMatches = matches.filter((m) => {
      if (m.status !== "FINISHED") return false;
      const matchDate = new Date(m.utcDate);
      return matchDate >= last24Hours;
    });

    console.log(`Found ${liveMatches.length} live/active matches, ${recentlyFinishedMatches.length} recently finished matches`);

    let processedCount = 0;
    let errorCount = 0;
    const supabase = createServerClient();

    const processMatch = async (match: FootballMatchSummary) => {
      const eventsData = await fetchMatchEvents(match.id);
      const emojiCounts = await fetchEmojiCounts(String(match.id));

      await analyzeSentiment({
        matchId: String(match.id),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        status: eventsData.status,
        goals: eventsData.goals,
        userReactions: [],
        homeScore: eventsData.homeScore,
        awayScore: eventsData.awayScore,
        emojiCounts,
      });
    };

    for (const match of liveMatches) {
      try {
        await processMatch(match);
        processedCount++;
      } catch (err) {
        console.error(`Error processing live match ${match.id}:`, err);
        errorCount++;
      }
    }

    for (const match of recentlyFinishedMatches) {
      try {
        const { data: existing } = await supabase
          .from('sentiment_snapshots')
          .select('created_at')
          .eq('match_id', String(match.id))
          .order('created_at', { ascending: false })
          .limit(1);

        if (existing && existing.length > 0) {
          const lastSnapshot = new Date(existing[0].created_at);
          const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
          if (lastSnapshot > twoHoursAgo) {
            console.log(`Skipping finished match ${match.id}, sentiment already analyzed recently`);
            continue;
          }
        }

        await processMatch(match);
        processedCount++;
      } catch (err) {
        console.error(`Error processing finished match ${match.id}:`, err);
        errorCount++;
      }
    }

    return NextResponse.json({
      success: true,
      allStatuses,
      liveMatches: liveMatches.length,
      recentlyFinished: recentlyFinishedMatches.length,
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
