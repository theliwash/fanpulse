"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar } from 'recharts';

type Snapshot = {
  id: number | string;
  match_id: string;
  nation: string;
  sentiment_score: number;
  mood_label: string;
  top_emotion: string;
  key_talking_point: string;
  created_at: string;
};

type MatchSummary = {
  id: number | string;
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
};

export default function NationSentimentClient({ nation }: { nation: string }) {
  const [view, setView] = useState<'timeline' | 'journey'>('timeline');
  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [matchOptions, setMatchOptions] = useState<{ matchId: string; label: string; date?: string }[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const positiveColor = '#10b981';
  const negativeColor = '#ef4444';

  useEffect(() => {
    // Fetch all nation snapshots and matches
    async function load() {
      setLoading(true);
      try {
        const [snapRes, matchesRes] = await Promise.all([
          fetch(`/api/sentiment/nation?nation=${encodeURIComponent(nation)}`),
          fetch('/api/football/matches'),
        ]);

        const snaps = (await snapRes.json()) as Snapshot[];
        const matchesJson = (await matchesRes.json()) as MatchSummary[];

        setAllSnapshots(Array.isArray(snaps) ? snaps : []);
        setMatches(Array.isArray(matchesJson) ? matchesJson : []);

        // Build match options
        const byMatch = new Map<string, Snapshot[]>();
        for (const s of snaps ?? []) {
          byMatch.set(String(s.match_id), (byMatch.get(String(s.match_id)) ?? []).concat(s));
        }

        const options: { matchId: string; label: string; date?: string }[] = [];
        byMatch.forEach((arr, matchId) => {
          const m = matchesJson?.find((mm) => String(mm.id) === String(matchId));
          const opponent = m
            ? (m.homeTeam === nation ? m.awayTeam : m.homeTeam)
            : 'Opponent';
          const date = m?.utcDate;
          options.push({ matchId: String(matchId), label: `${opponent} ${date ? '— ' + new Date(date).toLocaleDateString() : ''}`, date });
        });

        // sort options by date when available
        options.sort((a, b) => {
          if (a.date && b.date) return new Date(a.date).getTime() - new Date(b.date).getTime();
          return a.matchId.localeCompare(b.matchId);
        });

        setMatchOptions(options);
        if (options.length > 0) setSelectedMatchId(options[0].matchId);
      } catch (err) {
        console.error('Failed to load nation data', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [nation]);

  useEffect(() => {
    if (!selectedMatchId) return;
    let mounted = true;
    async function loadTimeline() {
      setLoading(true);
      try {
        const mid = String(selectedMatchId);
        const resp = await fetch(`/api/sentiment/match-timeline?match_id=${encodeURIComponent(mid)}&nation=${encodeURIComponent(nation)}`);
        const arr = await resp.json();
        if (!mounted) return;
        setTimeline(Array.isArray(arr) ? arr : []);
      } catch (err) {
        console.error('Failed to load timeline', err);
        setTimeline([]);
      } finally {
        setLoading(false);
      }
    }
    loadTimeline();
    return () => {
      mounted = false;
    };
  }, [selectedMatchId, nation]);

  const journeyData = useMemo(() => {
    const byMatch = new Map<string, Snapshot[]>();
    for (const s of allSnapshots) {
      const key = String(s.match_id);
      byMatch.set(key, (byMatch.get(key) ?? []).concat(s));
    }
    const items: { matchId: string; avg: number; opponent?: string; lastMood?: string }[] = [];
    byMatch.forEach((arr, matchId) => {
      const avg = Math.round(arr.reduce((s, x) => s + Number(x.sentiment_score), 0) / arr.length || 0);
      const m = matches.find((mm) => String(mm.id) === String(matchId));
      const opponent = m ? (m.homeTeam === nation ? m.awayTeam : m.homeTeam) : undefined;
      const lastMood = arr[arr.length - 1]?.mood_label;
      items.push({ matchId: String(matchId), avg, opponent, lastMood });
    });
    // sort by opponent date when possible
    items.sort((a, b) => {
      const ma = matches.find((mm) => String(mm.id) === a.matchId);
      const mb = matches.find((mm) => String(mm.id) === b.matchId);
      if (ma?.utcDate && mb?.utcDate) return new Date(ma.utcDate).getTime() - new Date(mb.utcDate).getTime();
      return a.matchId.localeCompare(b.matchId);
    });
    return items;
  }, [allSnapshots, matches, nation]);

  const avgTournamentSentiment = useMemo(() => {
    if (journeyData.length === 0) return 0;
    return Math.round(journeyData.reduce((s, x) => s + x.avg, 0) / journeyData.length);
  }, [journeyData]);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-2 mb-4">
          <button
            className={`px-3 py-1 rounded ${view === 'timeline' ? 'bg-gray-800' : 'bg-gray-900 border border-gray-800'}`}
            onClick={() => setView('timeline')}
          >
            Match Timeline
          </button>
          <button
            className={`px-3 py-1 rounded ${view === 'journey' ? 'bg-gray-800' : 'bg-gray-900 border border-gray-800'}`}
            onClick={() => setView('journey')}
          >
            Tournament Journey
          </button>
        </div>

        {view === 'timeline' ? (
          <div>
            <div className="mb-4">
              <label className="text-gray-400 text-sm">Select match</label>
              <select
                className="ml-2 bg-gray-900 border border-gray-800 text-white rounded px-2 py-1"
                value={selectedMatchId ?? ''}
                onChange={(e) => setSelectedMatchId(e.target.value)}
              >
                {matchOptions.map((o) => (
                  <option key={o.matchId} value={o.matchId}>{o.label}</option>
                ))}
              </select>
            </div>

            {loading ? (
              <div>Loading…</div>
            ) : !timeline || timeline.length === 0 ? (
              <div className="text-gray-400">No sentiment data for this match yet</div>
            ) : (
              <div>
                <div style={{ width: '100%', height: 320 }}>
                  <ResponsiveContainer>
                    <LineChart data={timeline.map((t) => ({ ...t, created_at: t.created_at }))}>
                      <CartesianGrid stroke="#1f2937" />
                      <XAxis dataKey="created_at" tickFormatter={(v) => new Date(String(v)).toLocaleTimeString()} />
                      <YAxis domain={[-100, 100]} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const d = payload[0].payload as Snapshot;
                          return (
                            <div className="bg-gray-900 border border-gray-800 p-2 text-white text-sm">
                              <div>{new Date(d.created_at).toLocaleString()}</div>
                              <div>Score: {d.sentiment_score}</div>
                              <div>Mood: {d.mood_label}</div>
                              <div className="text-xs text-gray-400">{d.key_talking_point}</div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine y={0} stroke="#9ca3af" />
                      <Line
                        type="monotone"
                        dataKey="sentiment_score"
                        stroke={timeline[timeline.length - 1].sentiment_score >= 0 ? positiveColor : negativeColor}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 bg-gray-900 border border-gray-800 rounded p-4">
                  <div className="text-gray-400 text-sm">Most recent</div>
                  <div className="text-white font-semibold">{timeline[timeline.length - 1].top_emotion}</div>
                  <div className="text-gray-300">{timeline[timeline.length - 1].key_talking_point}</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            {loading ? (
              <div>Loading…</div>
            ) : journeyData.length < 2 ? (
              <div className="text-gray-400">Check back after more matches are played</div>
            ) : (
              <div>
                <div style={{ width: '100%', height: 360 }}>
                  <ResponsiveContainer>
                    <BarChart data={journeyData.map((d, i) => ({ name: `Match ${i + 1}`, avg: d.avg, opponent: d.opponent ?? 'Opponent', lastMood: d.lastMood }))}>
                      <CartesianGrid stroke="#1f2937" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[-100, 100]} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const raw = payload[0].payload as unknown;
                          if (typeof raw !== 'object' || raw === null) return null;
                          const d = raw as { opponent?: string; avg?: number; lastMood?: string };
                          return (
                            <div className="bg-gray-900 border border-gray-800 p-2 text-white text-sm">
                              <div>{d.opponent}</div>
                              <div>Avg: {d.avg}</div>
                              <div>Mood: {d.lastMood}</div>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="avg" fill="#10b981" stroke="#10b981" >
                        {/* We will set color via fillCallback in below mapping */}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 text-gray-400">{journeyData.length} matches played, average sentiment: <span className="text-white">{avgTournamentSentiment}</span></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
