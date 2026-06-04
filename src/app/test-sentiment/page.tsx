"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  FootballMatchSummary,
  MatchEventsResponse,
} from "@/lib/football-types";

type SentimentResult = {
  nation: string;
  sentiment_score: number;
  mood_label: string;
  top_emotion: string;
  key_talking_point: string;
};

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

export default function TestSentimentPage() {
  const [matches, setMatches] = useState<FootballMatchSummary[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);

  const [analysing, setAnalysing] = useState(false);
  const [results, setResults] = useState<SentimentResult[] | null>(null);
  const [analyseError, setAnalyseError] = useState<string | null>(null);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesError(null);

    try {
      const response = await fetch("/api/football/matches");
      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data: unknown = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Invalid matches response");
      }

      setMatches(data as FootballMatchSummary[]);
      if ((data as FootballMatchSummary[]).length > 0) {
        setSelectedMatchId((data as FootballMatchSummary[])[0].id);
      }
    } catch (err) {
      setMatches([]);
      setMatchesError(err instanceof Error ? err.message : "Failed to load matches");
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  async function handleAnalyse() {
    setAnalyseError(null);
    setResults(null);

    if (!selectedMatchId) {
      setAnalyseError("Select a match before analysis");
      return;
    }

    const match = matches.find((m) => m.id === selectedMatchId);
    if (!match) {
      setAnalyseError("Selected match not found");
      return;
    }

    setAnalysing(true);

    try {
      const params = new URLSearchParams({ match_id: String(selectedMatchId) });
      const eventsResp = await fetch(`/api/football/match-events?${params.toString()}`);
      if (!eventsResp.ok) throw new Error(await parseApiError(eventsResp));

      const eventsData = (await eventsResp.json()) as MatchEventsResponse;

      const payload = {
        matchId: String(match.id),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        status: eventsData.status,
        goals: eventsData.goals ?? [],
        userReactions: [],
      };

      const analyzeResp = await fetch("/api/sentiment/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const analyzeJson = await analyzeResp.json();
      if (!analyzeResp.ok) throw new Error(analyzeJson?.error || "Analysis failed");

      setResults(analyzeJson as SentimentResult[]);
    } catch (err) {
      setAnalyseError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalysing(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-8">
      <div style={{ background: "var(--background)", color: "var(--foreground)" }}>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold">Sentiment Analyzer — Test UI</h1>
          <p className="mt-1 text-sm text-neutral-400">Pick a match and run the analyser.</p>
        </header>

        <section className="mb-6">
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-sm font-medium text-neutral-500">Match</span>
              <div className="mt-2">
                <select
                  value={selectedMatchId ?? ""}
                  onChange={(e) => setSelectedMatchId(Number(e.target.value))}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-100"
                  disabled={matchesLoading}
                >
                  {matchesLoading && <option>Loading matches…</option>}
                  {!matchesLoading && matches.length === 0 && <option>No matches</option>}
                  {!matchesLoading &&
                    matches.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.homeTeam} vs {m.awayTeam} — {m.status}
                      </option>
                    ))}
                </select>
              </div>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={handleAnalyse}
                disabled={analysing || matchesLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {analysing ? "Analysing…" : "Analyse Sentiment"}
              </button>
            </div>
          </div>

          {matchesError && (
            <p className="mt-3 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {matchesError}
            </p>
          )}
        </section>

        <section>
          {analyseError && (
            <div className="mb-4 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {analyseError}
            </div>
          )}

          {results && results.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {results.map((r) => (
                <article key={r.nation} className="rounded-lg border border-neutral-700 bg-neutral-900/40 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-neutral-100">{r.nation}</h3>
                    <span className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-200">{r.mood_label}</span>
                  </div>

                  <p className="mt-2 text-sm text-neutral-400">
                    <span className="font-medium text-neutral-200">Top emotion:</span> {r.top_emotion}
                  </p>

                  <p className="mt-1 text-sm text-neutral-400">{r.key_talking_point}</p>

                  <div className="mt-3 flex items-center gap-3">
                    <div className="w-12 text-right text-sm text-neutral-300">{r.sentiment_score}</div>
                    <div className="flex-1">
                      <div className="h-3 w-full overflow-hidden rounded bg-neutral-800 border border-neutral-700">
                        <div className="flex h-full w-full">
                          <div className="w-1/2 flex items-center justify-end">
                            <div
                              style={{ width: `${Math.min(Math.max(-r.sentiment_score, 0), 100)}%` }}
                              className="h-full bg-red-500"
                            />
                          </div>
                          <div className="w-1/2 flex items-center">
                            <div
                              style={{ width: `${Math.min(Math.max(r.sentiment_score, 0), 100)}%` }}
                              className="h-full bg-green-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
