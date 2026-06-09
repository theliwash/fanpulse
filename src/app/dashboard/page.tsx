"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from 'next/link';
import type { FootballMatchSummary } from "@/lib/football-types";
import { TEAM_FLAGS } from "@/lib/flags";

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
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  const EMOJI_REACTIONS = [
    { key: 'fire', emoji: '🔥', label: 'Fire' },
    { key: 'shocked', emoji: '😱', label: 'Shocked' },
    { key: 'gutted', emoji: '😭', label: 'Gutted' },
    { key: 'angry', emoji: '😤', label: 'Angry' },
    { key: 'party', emoji: '🎉', label: 'Party' },
  ];

  const [reactions, setReactions] = useState<Record<string, Record<string, number>>>({});

  const incrementReaction = useCallback((matchId: string, key: string) => {
    setReactions((prev) => {
      const cur = prev[matchId] ?? {};
      return { ...prev, [matchId]: { ...cur, [key]: (cur[key] ?? 0) + 1 } };
    });
  }, []);

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
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());

  const displayedUpcomingMatches = showAllUpcoming ? upcomingMatches : upcomingMatches.slice(0, 8);

  async function handleAnalyse(match: FootballMatchSummary) {
    setAnalyseErrors((p) => ({ ...p, [String(match.id)]: "" }));
    setAnalysingIds((p) => ({ ...p, [String(match.id)]: true }));

    try {
      const params = new URLSearchParams({ match_id: String(match.id) });
      const eventsResp = await fetch(`/api/football/match-events?${params.toString()}`);
      if (!eventsResp.ok) throw new Error(await parseApiError(eventsResp));
      const eventsData: unknown = await eventsResp.json();

      let status: string | undefined;
      let goals: unknown;
      if (typeof eventsData === 'object' && eventsData !== null) {
        status = (eventsData as { status?: unknown }).status as string | undefined;
        goals = (eventsData as { goals?: unknown }).goals;
      }

      const payload = {
        matchId: String(match.id),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        status: status ?? '',
        goals: Array.isArray(goals) ? goals : [],
        userReactions: [],
      };

      const analyzeResp = await fetch("/api/sentiment/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result: unknown = await analyzeResp.json();
      if (!analyzeResp.ok) {
        let errMsg = "Analysis failed";
        if (typeof result === 'object' && result !== null) {
          const v = (result as { error?: unknown }).error;
          if (typeof v === 'string') errMsg = v;
        }
        throw new Error(errMsg);
      }

      if (!Array.isArray(result)) {
        throw new Error("Invalid analysis response");
      }

      setSentiments((p) => ({ ...p, [String(match.id)]: result as SentimentResult[] }));
    } catch (err) {
      setAnalyseErrors((p) => ({ ...p, [String(match.id)]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setAnalysingIds((p) => ({ ...p, [String(match.id)]: false }));
    }
  }

  const tournamentStart = useMemo(() => new Date('2026-06-11T00:00:00Z'), []);
  const daysUntil = (() => {
    const now = new Date();
    const diff = tournamentStart.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  })();

  function getMoodStyles(mood: string) {
    const lower = String(mood).toLowerCase();
    if (lower === 'euphoric' || lower === 'confident') {
      return { bg: 'rgba(20,83,45,0.08)', bar: '#16a34a', text: 'text-emerald-200' };
    }
    if (lower === 'neutral') {
      return { bg: 'rgba(100,116,139,0.06)', bar: '#9ca3af', text: 'text-neutral-200' };
    }
    if (lower === 'nervous' || lower === 'frustrated') {
      return { bg: 'rgba(245,158,11,0.08)', bar: '#f59e0b', text: 'text-amber-100' };
    }
    return { bg: 'rgba(127,29,29,0.08)', bar: '#b91c1c', text: 'text-red-100' };
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6">
          <div>
            <h1 className="text-5xl md:text-7xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">FanPulse ⚽</h1>
            <p className="text-gray-400 mt-2">Real-time World Cup 2026 fan sentiment</p>
            <div className="mt-2 text-emerald-400">Tournament starts in {daysUntil} day{daysUntil !== 1 ? 's' : ''}</div>
          </div>

          <div className="mt-4 md:mt-0 text-gray-400 text-right">
            <div className="text-sm">Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</div>
            <div className="mt-2">
              <button onClick={fetchMatches} className="text-gray-400">Refresh</button>
            </div>
          </div>
        </header>

        <div className="h-px my-8 bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />

        <section>
          <h2 className="text-2xl font-bold text-white mb-4 mt-8 border-l-4 border-emerald-500 pl-3">Live Now</h2>

          {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-gray-800 animate-pulse rounded-2xl h-32" />
              ))
            ) : (
              liveMatches.map((m) => (
                <article key={m.id} className="bg-gradient-to-br from-gray-900 to-gray-800/50 border border-gray-800 rounded-2xl p-5 hover:border-gray-500 hover:shadow-lg hover:shadow-black/20 transition-all duration-200">
                  <div className="grid grid-cols-3 items-center gap-4">
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{TEAM_FLAGS[m.homeTeam] ?? ''}</span>
                        <div>
                          <Link href={`/nations/${encodeURIComponent(m.homeTeam)}`} className="text-xl font-bold text-white hover:text-emerald-400 transition-colors cursor-pointer">
                            {m.homeTeam}
                          </Link>
                        </div>
                      </div>
                    </div>

                    <div className="text-center">
                      <div className="text-base text-gray-300">{formatKickoff(m.utcDate)}</div>
                      <div className="flex justify-center mt-2">
                        <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-3 py-1 text-xs font-semibold animate-pulse">LIVE</span>
                      </div>
                      <div className="flex justify-center mt-3 flex-col items-center">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAnalyse(m)}
                            disabled={!!analysingIds[String(m.id)]}
                            className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                          >
                            {analysingIds[String(m.id)] ? 'Analysing…' : 'Analyse Sentiment'}
                          </button>
                          <button
                            onClick={() => setExpandedMatchId((prev) => (prev === String(m.id) ? null : String(m.id)))}
                            className="text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                          >
                            {expandedMatchId === String(m.id) ? 'Hide' : 'Details'}
                          </button>
                        </div>
                        {analyseErrors[String(m.id)] && <div className="text-xs text-red-400 mt-2">{analyseErrors[String(m.id)]}</div>}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <div>
                          <Link href={`/nations/${encodeURIComponent(m.awayTeam)}`} className="text-xl font-bold text-white hover:text-emerald-400 transition-colors cursor-pointer">
                            {m.awayTeam}
                          </Link>
                        </div>
                        <span className="text-2xl">{TEAM_FLAGS[m.awayTeam] ?? ''}</span>
                      </div>
                    </div>
                  </div>

                  {sentiments[String(m.id)] && (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                      {sentiments[String(m.id)].map((r) => {
                        const mood = String(r.mood_label).toLowerCase();
                        const widthPercent = Math.max(0, Math.min(100, (r.sentiment_score + 100) / 2));
                        let cardClass = 'rounded-xl p-4 bg-gray-800 border border-gray-700';
                        if (mood === 'euphoric' || mood === 'confident') cardClass = 'rounded-xl p-4 bg-emerald-950 border border-emerald-800';
                        if (mood === 'nervous' || mood === 'frustrated') cardClass = 'rounded-xl p-4 bg-amber-950 border border-amber-800';
                        if (mood === 'devastated' || mood === 'furious') cardClass = 'rounded-xl p-4 bg-red-950 border border-red-800';

                        return (
                          <div key={r.nation} className={cardClass}>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium text-gray-300">
                                <Link href={`/nations/${encodeURIComponent(r.nation)}`} className="flex items-center gap-2 hover:underline">
                                  <span>{TEAM_FLAGS[r.nation] ?? '🏴'}</span>
                                  <span>{r.nation}</span>
                                  <span className="text-gray-400 text-xs">→</span>
                                </Link>
                              </div>
                              <div className="text-lg font-bold text-white">{r.mood_label}</div>
                            </div>

                                    <div className="w-full bg-gray-700 rounded-full h-2 mt-3">
                                      {(() => {
                                        const styles = getMoodStyles(r.mood_label);
                                        return <div style={{ width: `${widthPercent}%`, height: '100%', borderRadius: 9999, background: styles.bar }} />;
                                      })()}
                                    </div>

                            <div className="text-xs text-gray-400 mt-1">Top emotion: <span className="font-medium text-gray-300">{r.top_emotion}</span></div>
                            <div className="text-xs text-gray-400 mt-1">{r.key_talking_point}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {liveStatuses.has(m.status) && (
                    <div className="mt-4">
                      <div className="text-gray-400 text-xs mb-2">Fan reactions</div>
                      <div className="flex items-center gap-2">
                        {EMOJI_REACTIONS.map((r) => {
                          const count = reactions[String(m.id)]?.[r.key] ?? 0;
                          return (
                            <button
                              key={r.key}
                              onClick={() => incrementReaction(String(m.id), r.key)}
                              className="bg-gray-800 hover:bg-gray-700 rounded-full px-3 py-2 flex items-center gap-2"
                            >
                              <span className="text-lg">{r.emoji}</span>
                              <span className="text-sm text-gray-300">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          <h2 className="text-2xl font-bold text-white mb-4 mt-12 border-l-4 border-amber-500 pl-3">Upcoming</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-gray-800 animate-pulse rounded-2xl h-32" />
              ))
            ) : (
              displayedUpcomingMatches.map((m) => {
                const isPreMatch = m.status === 'TIMED' || m.status === 'SCHEDULED';
                const isLive = m.status === 'LIVE' || m.status === 'IN_PLAY';

                if (isPreMatch) {
                  return (
                    <article key={m.id} className="bg-gradient-to-br from-gray-900 to-gray-800/50 border border-gray-800 rounded-2xl p-5 hover:border-gray-500 hover:shadow-lg hover:shadow-black/20 transition-all duration-200">
                      <div className="grid grid-cols-3 items-center gap-4">
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{TEAM_FLAGS[m.homeTeam] ?? ''}</span>
                            <Link href={`/nations/${encodeURIComponent(m.homeTeam)}`} className="text-xl font-bold text-white hover:text-emerald-400 transition-colors cursor-pointer">
                              {m.homeTeam}
                            </Link>
                          </div>
                        </div>

                        <div className="text-center">
                          <div className="text-base text-gray-300">{formatKickoff(m.utcDate)}</div>
                          <div className="flex justify-center mt-2">
                            <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-4 py-1.5 text-xs font-semibold">Pre-match</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Link href={`/nations/${encodeURIComponent(m.awayTeam)}`} className="text-xl font-bold text-white hover:text-emerald-400 transition-colors cursor-pointer">
                              {m.awayTeam}
                            </Link>
                            <span className="text-2xl">{TEAM_FLAGS[m.awayTeam] ?? ''}</span>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                }

                return (
                  <article key={m.id} className="bg-gradient-to-br from-gray-900 to-gray-800/50 border border-gray-800 rounded-2xl p-5 hover:border-gray-500 hover:shadow-lg hover:shadow-black/20 transition-all duration-200">
                    <div className="grid grid-cols-3 items-center gap-4">
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{TEAM_FLAGS[m.homeTeam] ?? ''}</span>
                          <div>
                            <Link href={`/nations/${encodeURIComponent(m.homeTeam)}`} className="text-xl font-bold text-white hover:text-emerald-400 transition-colors cursor-pointer">
                              {m.homeTeam}
                            </Link>
                          </div>
                        </div>
                      </div>

                      <div className="text-center">
                        <div className="text-base text-gray-300">{formatKickoff(m.utcDate)}</div>
                        <div className="flex justify-center mt-2">
                          {isLive ? (
                            <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-3 py-1 text-xs font-semibold animate-pulse">LIVE</span>
                          ) : (
                            <span className="text-sm text-gray-400">{m.status}</span>
                          )}
                        </div>

                        {isLive && (
                          <div className="mt-3">
                            <div className="flex justify-center gap-2">
                              <button
                                onClick={() => handleAnalyse(m)}
                                disabled={!!analysingIds[String(m.id)]}
                                className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                              >
                                {analysingIds[String(m.id)] ? 'Analysing…' : 'Analyse Sentiment'}
                              </button>
                              <button
                                onClick={() => setExpandedMatchId((prev) => (prev === String(m.id) ? null : String(m.id)))}
                                className="text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                              >
                                {expandedMatchId === String(m.id) ? 'Hide' : 'Details'}
                              </button>
                            </div>
                            {analyseErrors[String(m.id)] && <div className="text-xs text-red-400 mt-2">{analyseErrors[String(m.id)]}</div>}
                          </div>
                        )}
                      </div>

                      <div className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <div>
                            <Link href={`/nations/${encodeURIComponent(m.awayTeam)}`} className="text-xl font-bold text-white hover:text-emerald-400 transition-colors cursor-pointer">
                              {m.awayTeam}
                            </Link>
                          </div>
                          <span className="text-2xl">{TEAM_FLAGS[m.awayTeam] ?? ''}</span>
                        </div>
                      </div>
                    </div>

                    { !isPreMatch && expandedMatchId === String(m.id) && isLive && (
                      <div className="mt-4">
                        <div className="text-gray-400 text-xs mb-2">Fan reactions</div>
                        <div className="flex items-center gap-2">
                          {EMOJI_REACTIONS.map((r) => {
                            const count = reactions[String(m.id)]?.[r.key] ?? 0;
                            return (
                              <button
                                key={r.key}
                                onClick={() => incrementReaction(String(m.id), r.key)}
                                className="bg-gray-800 hover:bg-gray-700 rounded-full px-3 py-2 flex items-center gap-2"
                              >
                                <span className="text-lg">{r.emoji}</span>
                                <span className="text-sm text-gray-300">{count}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          {upcomingMatches.length > 8 && (
            <div>
              <button onClick={() => setShowAllUpcoming((s) => !s)} className="group w-full bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl py-3 text-sm font-medium transition-colors border border-gray-700 mt-4">
                {showAllUpcoming ? (
                  <>Show less <span className="inline-block transition-transform group-hover:-translate-y-0.5">↑</span></>
                ) : (
                  <>Show all {upcomingMatches.length} upcoming matches <span className="inline-block transition-transform group-hover:translate-y-0.5">↓</span></>
                )}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
