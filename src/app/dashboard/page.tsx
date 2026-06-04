"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FootballMatchSummary } from "@/lib/football-types";
import ReactionForm from '@/components/ReactionForm';

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

function formatScore(score: FootballMatchSummary["score"]) {
  if (!score) return "– : –";
  const home = score.home ?? "–";
  const away = score.away ?? "–";
  return `${home} : ${away}`;
}

function formatKickoff(utcDate: string) {
  return new Date(utcDate).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function DashboardPage() {
  const [matches, setMatches] = useState<FootballMatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [sentiments, setSentiments] = useState<Record<string, SentimentResult[]>>({});
  const [analysingIds, setAnalysingIds] = useState<Record<string, boolean>>({});
  const [analyseErrors, setAnalyseErrors] = useState<Record<string, string>>({});
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/football/matches");
      if (!res.ok) throw new Error(await parseApiError(res));
      const data: unknown = await res.json();
      if (!Array.isArray(data)) throw new Error("Invalid matches response");
      setMatches(data as FootballMatchSummary[]);
      setLastUpdated(new Date());
    } catch (err) {
      setMatches([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatches();
    const id = setInterval(fetchMatches, 30_000);
    return () => clearInterval(id);
  }, [fetchMatches]);

  const liveStatuses = useMemo(() => new Set(["LIVE", "IN_PLAY"]), []);
  const upcomingStatuses = useMemo(() => new Set(["TIMED", "SCHEDULED", "UPCOMING"]), []);

  const liveMatches = matches.filter((m) => liveStatuses.has(m.status));
  const upcomingMatches = matches
    .filter((m) => upcomingStatuses.has(m.status) || m.status === "SCHEDULED")
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime())
    .slice(0, 8);

  async function handleAnalyse(match: FootballMatchSummary) {
    setAnalyseErrors((p) => ({ ...p, [String(match.id)]: "" }));
    setAnalysingIds((p) => ({ ...p, [String(match.id)]: true }));

    try {
      const params = new URLSearchParams({ match_id: String(match.id) });
      const eventsResp = await fetch(`/api/football/match-events?${params.toString()}`);
      if (!eventsResp.ok) throw new Error(await parseApiError(eventsResp));
      const eventsData = await eventsResp.json();

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

      const result = await analyzeResp.json();
      if (!analyzeResp.ok) throw new Error(result?.error || "Analysis failed");

      setSentiments((p) => ({ ...p, [String(match.id)]: result }));
    } catch (err) {
      setAnalyseErrors((p) => ({ ...p, [String(match.id)]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setAnalysingIds((p) => ({ ...p, [String(match.id)]: false }));
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div style={{ background: "var(--background)", color: "var(--foreground)" }}>
        <header className="mb-6 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">FanPulse ⚽</h1>
              <p className="text-sm text-neutral-400">Real-time World Cup fan sentiment</p>
            </div>
            <div className="text-right text-sm text-neutral-400">
              <div>Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : "—"}</div>
              <div className="mt-2">
                <button
                  onClick={fetchMatches}
                  className="rounded-md bg-neutral-800 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-700"
                >
                  Refresh now
                </button>
              </div>
            </div>
          </div>
        </header>

        <section className="mb-8">
          <h2 className="mb-3 text-xl font-semibold">Live Now</h2>
          {loading && <p className="text-sm text-neutral-400">Loading matches…</p>}
          {error && <p className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}

          {!loading && liveMatches.length === 0 && <p className="text-sm text-neutral-500">No live matches right now.</p>}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {liveMatches.map((m) => (
              <article key={m.id} className="rounded-lg border border-neutral-700 bg-neutral-900/40 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-neutral-100">{m.homeTeam} vs {m.awayTeam}</h3>
                      <span className="ml-2 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white">LIVE</span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-300">{formatScore(m.score)}</p>
                    <p className="mt-1 text-sm text-neutral-500">{m.status}</p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <button
                      onClick={() => handleAnalyse(m)}
                      disabled={!!analysingIds[String(m.id)]}
                      className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {analysingIds[String(m.id)] ? 'Analysing…' : 'Analyse Sentiment'}
                    </button>

                    <button
                      onClick={() => setExpandedMatchId((prev) => (prev === String(m.id) ? null : String(m.id)))}
                      className="rounded-md bg-neutral-700 px-2 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-600"
                    >
                      {expandedMatchId === String(m.id) ? 'Hide' : 'Details'}
                    </button>

                    {analyseErrors[String(m.id)] && (
                      <p className="text-xs text-red-400">{analyseErrors[String(m.id)]}</p>
                    )}
                  </div>
                </div>

                {sentiments[String(m.id)] && (
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {sentiments[String(m.id)].map((r) => (
                      <div key={r.nation} className="rounded-md border border-neutral-700 bg-neutral-800 p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-neutral-100">{r.nation}</div>
                          <div className="text-sm text-neutral-200">{r.mood_label}</div>
                        </div>
                        <div className="mt-2 text-sm text-neutral-300">Top emotion: <span className="font-medium text-neutral-100">{r.top_emotion}</span></div>
                        <div className="mt-1 text-sm text-neutral-300">{r.key_talking_point}</div>
                      </div>
                    ))}
                  </div>
                )}

                {expandedMatchId === String(m.id) && (
                  <div className="mt-4">
                    <ReactionForm
                      matchId={String(m.id)}
                      homeTeam={m.homeTeam}
                      awayTeam={m.awayTeam}
                      onReactionSubmitted={() => handleAnalyse(m)}
                    />
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">Upcoming</h2>
          {!loading && upcomingMatches.length === 0 && <p className="text-sm text-neutral-500">No upcoming matches.</p>}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {upcomingMatches.map((m) => {
              const isLive = liveStatuses.has(m.status);
              const isPreMatch = m.status === "TIMED" || m.status === "SCHEDULED";

              if (isPreMatch) {
                // Simple pre-match card: teams, kickoff and Pre-match badge
                return (
                  <article key={m.id} className="rounded-lg border border-neutral-700 bg-neutral-900/40 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-neutral-100">{m.homeTeam} vs {m.awayTeam}</h3>
                          <span className="ml-2 rounded bg-yellow-600 px-2 py-1 text-xs font-medium text-white">Pre-match</span>
                        </div>
                        <p className="mt-1 text-sm text-neutral-300">Kickoff: {formatKickoff(m.utcDate)}</p>
                      </div>
                    </div>
                  </article>
                );
              }

              return (
                <article key={m.id} className="rounded-lg border border-neutral-700 bg-neutral-900/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-neutral-100">{m.homeTeam} vs {m.awayTeam}</h3>
                        <span className="ml-2 rounded bg-neutral-700 px-2 py-1 text-xs font-medium text-neutral-200">{m.status}</span>
                      </div>
                      <p className="mt-1 text-sm text-neutral-300">Kickoff: {formatKickoff(m.utcDate)}</p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {isLive && (
                        <button
                          onClick={() => handleAnalyse(m)}
                          disabled={!!analysingIds[String(m.id)]}
                          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {analysingIds[String(m.id)] ? 'Analysing…' : 'Analyse Sentiment'}
                        </button>
                      )}

                      {isLive && (
                        <button
                          onClick={() => setExpandedMatchId((prev) => (prev === String(m.id) ? null : String(m.id)))}
                          className="rounded-md bg-neutral-700 px-2 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-600"
                        >
                          {expandedMatchId === String(m.id) ? 'Hide' : 'Details'}
                        </button>
                      )}

                      {analyseErrors[String(m.id)] && (
                        <p className="text-xs text-red-400">{analyseErrors[String(m.id)]}</p>
                      )}
                    </div>
                  </div>

                  {isLive && sentiments[String(m.id)] && (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {sentiments[String(m.id)].map((r) => (
                        <div key={r.nation} className="rounded-md border border-neutral-700 bg-neutral-800 p-3">
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-neutral-100">{r.nation}</div>
                            <div className="text-sm text-neutral-200">{r.mood_label}</div>
                          </div>
                          <div className="mt-2 text-sm text-neutral-300">Top emotion: <span className="font-medium text-neutral-100">{r.top_emotion}</span></div>
                          <div className="mt-1 text-sm text-neutral-300">{r.key_talking_point}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {isLive && expandedMatchId === String(m.id) && (
                    <div className="mt-4">
                      <ReactionForm
                        matchId={String(m.id)}
                        homeTeam={m.homeTeam}
                        awayTeam={m.awayTeam}
                        onReactionSubmitted={() => handleAnalyse(m)}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
