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
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
      return { bar: '#16a34a' };
    }
    if (lower === 'neutral') {
      return { bar: '#9ca3af' };
    }
    if (lower === 'nervous' || lower === 'frustrated') {
      return { bar: '#f59e0b' };
    }
    return { bar: '#b91c1c' };
  }

  function FlagCircle({ team }: { team: string }) {
    return (
      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm leading-none shrink-0">
        {TEAM_FLAGS[team] ?? '🏴'}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">

        <header className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">
              FanPulse<span className="text-emerald-400"> ✦</span>
            </h1>
            <p className="text-xs text-zinc-500 mt-1">Real-time World Cup 2026 fan sentiment</p>
            <div className="mt-1 text-xs text-emerald-400">
              Tournament starts in {daysUntil} day{daysUntil !== 1 ? 's' : ''}
            </div>
          </div>
          <div className="mt-4 md:mt-0 text-right">
            <div className="text-xs text-zinc-500">
              Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
            </div>
            <button onClick={fetchMatches} className="mt-1 text-xs text-zinc-500 hover:text-white transition-colors">
              Refresh
            </button>
          </div>
        </header>

        {error && <div className="text-red-400 text-sm mb-4">{error}</div>}

        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Live Now</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-zinc-900 animate-pulse rounded-xl h-24" />
              ))
            ) : (
              liveMatches.map((m) => (
                <article key={m.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:bg-zinc-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FlagCircle team={m.homeTeam} />
                      <Link href={`/nations/${encodeURIComponent(m.homeTeam)}`} className="text-sm font-medium text-white hover:text-emerald-400 transition-colors">
                        {m.homeTeam}
                      </Link>
                    </div>
                    <span className="text-sm font-semibold text-white tabular-nums">{m.score?.home ?? '—'}</span>
                  </div>

                  <div className="my-2.5 h-px bg-zinc-800" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FlagCircle team={m.awayTeam} />
                      <Link href={`/nations/${encodeURIComponent(m.awayTeam)}`} className="text-sm font-medium text-white hover:text-emerald-400 transition-colors">
                        {m.awayTeam}
                      </Link>
                    </div>
                    <span className="text-sm font-semibold text-white tabular-nums">{m.score?.away ?? '—'}</span>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-red-500">
                      <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse inline-block" />
                      LIVE
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleAnalyse(m)}
                        disabled={!!analysingIds[String(m.id)]}
                        className="text-xs text-zinc-400 hover:text-white transition-colors disabled:opacity-40"
                      >
                        {analysingIds[String(m.id)] ? 'Analysing…' : 'Analyse'}
                      </button>
                      <button
                        onClick={() => setExpandedMatchId((prev) => prev === String(m.id) ? null : String(m.id))}
                        className="text-xs text-zinc-400 hover:text-white transition-colors"
                      >
                        {expandedMatchId === String(m.id) ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {analyseErrors[String(m.id)] && (
                    <div className="text-xs text-red-400 mt-2">{analyseErrors[String(m.id)]}</div>
                  )}

                  {sentiments[String(m.id)] && (
                    <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
                      {sentiments[String(m.id)].map((r) => {
                        const widthPercent = Math.max(0, Math.min(100, (r.sentiment_score + 100) / 2));
                        const styles = getMoodStyles(r.mood_label);
                        return (
                          <div key={r.nation}>
                            <div className="flex items-center justify-between mb-1">
                              <Link href={`/nations/${encodeURIComponent(r.nation)}`} className="flex items-center gap-2 text-xs text-zinc-400 hover:text-white transition-colors">
                                <span>{TEAM_FLAGS[r.nation] ?? '🏴'}</span>
                                <span>{r.nation}</span>
                              </Link>
                              <span className="text-xs font-medium text-white">{r.mood_label}</span>
                            </div>
                            <div className="w-full bg-zinc-800 rounded-full h-1">
                              <div style={{ width: `${widthPercent}%`, height: '100%', borderRadius: 9999, background: styles.bar }} />
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">{r.key_talking_point}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {liveStatuses.has(m.status) && (
                    <div className="mt-3 border-t border-zinc-800 pt-3">
                      <div className="text-xs text-zinc-500 mb-2">Fan reactions</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {EMOJI_REACTIONS.map((r) => {
                          const count = reactions[String(m.id)]?.[r.key] ?? 0;
                          return (
                            <button
                              key={r.key}
                              onClick={() => incrementReaction(String(m.id), r.key)}
                              className="bg-zinc-800 hover:bg-zinc-700 rounded-full px-2.5 py-1.5 flex items-center gap-1.5 transition-colors"
                            >
                              <span className="text-sm">{r.emoji}</span>
                              <span className="text-xs text-zinc-400">{count}</span>
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

          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 mt-8">Upcoming</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-zinc-900 animate-pulse rounded-xl h-24" />
              ))
            ) : (
              displayedUpcomingMatches.map((m) => (
                <article key={m.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:bg-zinc-800 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FlagCircle team={m.homeTeam} />
                      <Link href={`/nations/${encodeURIComponent(m.homeTeam)}`} className="text-sm font-medium text-white hover:text-emerald-400 transition-colors">
                        {m.homeTeam}
                      </Link>
                    </div>
                  </div>

                  <div className="my-2.5 h-px bg-zinc-800" />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FlagCircle team={m.awayTeam} />
                      <Link href={`/nations/${encodeURIComponent(m.awayTeam)}`} className="text-sm font-medium text-white hover:text-emerald-400 transition-colors">
                        {m.awayTeam}
                      </Link>
                    </div>
                    <span className="text-xs text-zinc-400 shrink-0 ml-4">{formatKickoff(m.utcDate)}</span>
                  </div>
                </article>
              ))
            )}
          </div>

          {upcomingMatches.length > 8 && (
            <button
              onClick={() => setShowAllUpcoming((s) => !s)}
              className="group w-full mt-4 py-3 text-xs text-zinc-500 hover:text-white transition-colors rounded-xl border border-zinc-800 hover:border-zinc-600"
            >
              {showAllUpcoming ? (
                <>Show less <span className="inline-block transition-transform group-hover:-translate-y-0.5">↑</span></>
              ) : (
                <>Show all {upcomingMatches.length} upcoming matches <span className="inline-block transition-transform group-hover:translate-y-0.5">↓</span></>
              )}
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
