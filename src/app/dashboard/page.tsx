"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


function formatDateLabel(key: string) {
  const d = new Date(key + 'T00:00:00');
  return {
    day: d.toLocaleDateString('en-GB', { weekday: 'short' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  };
}

function getMatchStage(utcDate: string): string {
  const d = new Date(utcDate);
  // Numeric YYYYMMDD for easy range comparison
  const ymd = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  if (ymd >= 20260611 && ymd <= 20260627) return 'Group Stage';
  if (ymd >= 20260628 && ymd <= 20260704) return 'Round of 32';
  if (ymd >= 20260704 && ymd <= 20260707) return 'Round of 16';
  if (ymd >= 20260709 && ymd <= 20260712) return 'Quarter-finals';
  if (ymd >= 20260714 && ymd <= 20260715) return 'Semi-finals';
  if (ymd === 20260718) return 'Third Place Play-off';
  if (ymd === 20260719) return 'Final';
  return 'Knockout Stage';
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

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [matchTypeFilter, setMatchTypeFilter] = useState<'ALL' | 'LIVE' | 'UPCOMING' | 'RESULTS'>('ALL');
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);

  const dateDropdownRef = useRef<HTMLDivElement>(null);
  const teamDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dateDropdownOpen) return;
    function handler(e: MouseEvent) {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setDateDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dateDropdownOpen]);

  useEffect(() => {
    if (!teamDropdownOpen) return;
    function handler(e: MouseEvent) {
      if (teamDropdownRef.current && !teamDropdownRef.current.contains(e.target as Node)) {
        setTeamDropdownOpen(false);
        setTeamSearch('');
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [teamDropdownOpen]);

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

  const matchCountByDate = useMemo(() => {
    const counts: Record<string, number> = {};
    matches.forEach((m) => {
      const key = localDateKey(new Date(m.utcDate));
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [matches]);

  const matchDates = useMemo(() =>
    Object.keys(matchCountByDate).sort(),
    [matchCountByDate]
  );

  const teamsList = useMemo(() => {
    const set = new Set<string>();
    matches.forEach((m) => {
      if (m.homeTeam) set.add(m.homeTeam);
      if (m.awayTeam) set.add(m.awayTeam);
    });
    return Array.from(set).sort();
  }, [matches]);

  const filteredTeamsList = useMemo(() => {
    if (!teamSearch.trim()) return teamsList;
    const q = teamSearch.toLowerCase();
    return teamsList.filter((t) => t.toLowerCase().includes(q));
  }, [teamsList, teamSearch]);

  const filteredMatches = useMemo(() => {
    let result = matches;
    if (selectedDate) {
      result = result.filter((m) => localDateKey(new Date(m.utcDate)) === selectedDate);
    }
    if (selectedTeam) {
      result = result.filter((m) => (m.homeTeam ?? '') === selectedTeam || (m.awayTeam ?? '') === selectedTeam);
    }
    if (matchTypeFilter === 'LIVE') {
      result = result.filter((m) => liveStatuses.has(m.status));
    } else if (matchTypeFilter === 'UPCOMING') {
      result = result.filter((m) => upcomingStatuses.has(m.status));
    } else if (matchTypeFilter === 'RESULTS') {
      result = result.filter((m) => m.status === 'FINISHED');
    }
    return result;
  }, [matches, selectedDate, selectedTeam, matchTypeFilter, liveStatuses, upcomingStatuses]);

  const isDefaultView = matchTypeFilter === 'ALL' && selectedDate === null && selectedTeam === null;

  const liveMatches = useMemo(
    () => filteredMatches.filter((m) => liveStatuses.has(m.status)),
    [filteredMatches, liveStatuses]
  );

  const upcomingMatches = useMemo(
    () =>
      filteredMatches
        .filter((m) => upcomingStatuses.has(m.status))
        .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()),
    [filteredMatches, upcomingStatuses]
  );

  const displayedUpcomingMatches = showAllUpcoming ? upcomingMatches : upcomingMatches.slice(0, 8);

  const selectedDateLabel = useMemo(() => {
    if (!selectedDate) return null;
    const todayKey = localDateKey(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowKey = localDateKey(tomorrowDate);
    const { date } = formatDateLabel(selectedDate);
    if (selectedDate === todayKey) return `Today, ${date}`;
    if (selectedDate === tomorrowKey) return `Tomorrow, ${date}`;
    const { day } = formatDateLabel(selectedDate);
    return `${day}, ${date}`;
  }, [selectedDate]);

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
      let homeScore: number | null = null;
      let awayScore: number | null = null;
      if (typeof eventsData === 'object' && eventsData !== null) {
        status = (eventsData as { status?: unknown }).status as string | undefined;
        goals = (eventsData as { goals?: unknown }).goals;
        const hs = (eventsData as { homeScore?: unknown }).homeScore;
        const as = (eventsData as { awayScore?: unknown }).awayScore;
        homeScore = typeof hs === 'number' ? hs : null;
        awayScore = typeof as === 'number' ? as : null;
      }

      const payload = {
        matchId: String(match.id),
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        status: status ?? '',
        goals: Array.isArray(goals) ? goals : [],
        userReactions: [],
        homeScore,
        awayScore,
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
      if (!Array.isArray(result)) throw new Error("Invalid analysis response");
      setSentiments((p) => ({ ...p, [String(match.id)]: result as SentimentResult[] }));
    } catch (err) {
      setAnalyseErrors((p) => ({ ...p, [String(match.id)]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setAnalysingIds((p) => ({ ...p, [String(match.id)]: false }));
    }
  }

  const tournamentStart = useMemo(() => new Date('2026-06-11T00:00:00Z'), []);
  const tournamentStartLocal = useMemo(() => new Date('2026-06-11T00:00:00'), []);
  const daysUntil = (() => {
    const now = new Date();
    const diff = tournamentStart.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();
  const isToday = localDateKey(new Date()) === '2026-06-11';
  const hasStarted = new Date() >= tournamentStartLocal && !isToday;

  function getMoodStyles(mood: string) {
    const lower = String(mood).toLowerCase();
    if (lower === 'euphoric' || lower === 'confident') return { bar: '#16a34a' };
    if (lower === 'neutral') return { bar: '#9ca3af' };
    if (lower === 'nervous' || lower === 'frustrated') return { bar: '#f59e0b' };
    return { bar: '#b91c1c' };
  }

  function FlagCircle({ team }: { team: string | null }) {
    if (!team) {
      return <div className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />;
    }
    return (
      <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-sm leading-none shrink-0">
        {TEAM_FLAGS[team] ?? '🏴'}
      </div>
    );
  }

  function TeamRow({ team, score }: { team: string | null; score?: number | null }) {
    if (!team) {
      return (
        <div className="flex items-center gap-3">
          <FlagCircle team={null} />
          <span className="text-sm text-zinc-500 italic">TBD</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3">
        <FlagCircle team={team} />
        <Link href={`/nations/${encodeURIComponent(team)}`} className="text-sm font-medium text-white hover:text-emerald-400 transition-colors">
          {team}
        </Link>
        {score != null && <span className="text-sm font-semibold text-white tabular-nums ml-auto">{score}</span>}
      </div>
    );
  }

  function MatchCard({ m }: { m: FootballMatchSummary }) {
    const isLive = liveStatuses.has(m.status);
    const isFinished = m.status === 'FINISHED';
    const isTbd = !m.homeTeam || !m.awayTeam;
    const stage = isTbd ? getMatchStage(m.utcDate) : null;
    return (
      <article className={`border rounded-xl p-4 transition-colors ${
        isFinished
          ? 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
          : 'bg-zinc-900 border-zinc-800 hover:bg-zinc-800'
      }`}>
        {stage && (
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{stage}</div>
        )}

        <div className="flex items-center justify-between">
          <TeamRow team={m.homeTeam} />
          {(isLive || isFinished) && <span className="text-sm font-semibold text-white tabular-nums">{m.score?.home ?? '—'}</span>}
        </div>

        <div className="my-2.5 h-px bg-zinc-800" />

        <div className="flex items-center justify-between">
          <TeamRow team={m.awayTeam} />
          {isLive || isFinished
            ? <span className="text-sm font-semibold text-white tabular-nums">{m.score?.away ?? '—'}</span>
            : <span className="text-xs text-zinc-400 shrink-0 ml-4">{formatKickoff(m.utcDate)}</span>
          }
        </div>

        {isFinished && m.homeTeam && m.awayTeam && m.score && (
          <div className="my-3 text-center">
            <div className="text-lg font-bold text-white">
              {m.homeTeam} {m.score.home ?? '—'} - {m.score.away ?? '—'} {m.awayTeam}
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          {isLive ? (
            <div className="flex items-center gap-1.5 text-xs text-red-500">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse inline-block" />
              LIVE
            </div>
          ) : isFinished ? (
            <div className="text-xs text-zinc-500">FT</div>
          ) : (
            <div />
          )}
          {isLive && (
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
          )}
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

        {isLive && (
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
    );
  }

  const pillBase = "shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors";
  const pillActive = `${pillBase} bg-white text-black font-semibold`;
  const pillInactive = `${pillBase} bg-transparent text-zinc-400 border border-zinc-700 hover:border-zinc-500`;

  const dropdownBtnBase = "flex items-center gap-2 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap";

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
              {isToday
                ? 'Tournament starts today! 🎉'
                : hasStarted
                  ? 'World Cup 2026 is live! ⚽'
                  : `Tournament starts in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`
              }
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

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">

          {/* Date dropdown */}
          <div className="relative" ref={dateDropdownRef}>
            <button
              onClick={() => { setDateDropdownOpen((o) => !o); setTeamDropdownOpen(false); }}
              className={`${dropdownBtnBase} ${selectedDate ? 'text-white border-zinc-500' : 'text-zinc-400'}`}
            >
              <span>📅</span>
              <span>{selectedDateLabel ?? 'All dates'}</span>
              <svg className="w-3 h-3 text-zinc-500 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {dateDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl p-2 max-h-80 overflow-y-auto z-50 min-w-[220px] scrollbar-hide">
                <button
                  onClick={() => { setSelectedDate(null); setDateDropdownOpen(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedDate === null ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  All dates
                </button>
                {matchDates.map((key) => {
                  const { day, date } = formatDateLabel(key);
                  const count = matchCountByDate[key];
                  return (
                    <button
                      key={key}
                      onClick={() => { setSelectedDate(key); setDateDropdownOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedDate === key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-zinc-500 w-7 text-xs shrink-0">{day}</span>
                        <span>{date}</span>
                      </span>
                      <span className="text-xs text-zinc-500 ml-3">{count} match{count !== 1 ? 'es' : ''}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Team dropdown */}
          <div className="relative" ref={teamDropdownRef}>
            <button
              onClick={() => { setTeamDropdownOpen((o) => !o); setDateDropdownOpen(false); }}
              className={`${dropdownBtnBase} ${selectedTeam ? 'text-white border-zinc-500' : 'text-zinc-400'}`}
            >
              <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>
                {selectedTeam
                  ? <>{TEAM_FLAGS[selectedTeam] ?? '🏴'} {selectedTeam}</>
                  : 'All teams'
                }
              </span>
              <svg className="w-3 h-3 text-zinc-500 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {teamDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 min-w-[220px]">
                <div className="p-2 border-b border-zinc-800">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search teams…"
                    value={teamSearch}
                    onChange={(e) => setTeamSearch(e.target.value)}
                    className="w-full bg-zinc-800 text-white text-sm rounded-lg px-3 py-1.5 outline-none placeholder-zinc-500"
                  />
                </div>
                <div className="p-2 max-h-72 overflow-y-auto scrollbar-hide">
                  <button
                    onClick={() => { setSelectedTeam(null); setTeamDropdownOpen(false); setTeamSearch(''); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedTeam === null ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    All teams
                  </button>
                  {filteredTeamsList.map((team) => (
                    <button
                      key={team}
                      onClick={() => { setSelectedTeam(team); setTeamDropdownOpen(false); setTeamSearch(''); }}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedTeam === team ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                      }`}
                    >
                      <span>{TEAM_FLAGS[team] ?? '🏴'}</span>
                      <span>{team}</span>
                    </button>
                  ))}
                  {filteredTeamsList.length === 0 && (
                    <p className="text-xs text-zinc-500 px-3 py-2">No teams found</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Separator */}
          <div className="h-6 w-px bg-zinc-700" />

          {/* Type pills */}
          {(['ALL', 'LIVE', 'UPCOMING', 'RESULTS'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setMatchTypeFilter(type)}
              className={matchTypeFilter === type ? pillActive : pillInactive}
            >
              {type}
            </button>
          ))}

          {/* Match count */}
          <span className="text-xs text-zinc-500 whitespace-nowrap">
            {loading ? '…' : `${filteredMatches.length} match${filteredMatches.length !== 1 ? 'es' : ''}`}
          </span>
        </div>

        <section>
          {isDefaultView ? (
            <>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Live Now</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {loading
                  ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-zinc-900 animate-pulse rounded-xl h-24" />)
                  : liveMatches.map((m) => <MatchCard key={m.id} m={m} />)
                }
              </div>

              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3 mt-8">Upcoming</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-zinc-900 animate-pulse rounded-xl h-24" />)
                  : displayedUpcomingMatches.map((m) => <MatchCard key={m.id} m={m} />)
                }
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
            </>
          ) : (
            <>
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Matches</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-zinc-900 animate-pulse rounded-xl h-24" />)
                  : filteredMatches.length === 0
                    ? <p className="text-sm text-zinc-500 col-span-2 py-8 text-center">No matches found</p>
                    : filteredMatches.map((m) => <MatchCard key={m.id} m={m} />)
                }
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
