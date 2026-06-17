"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar } from 'recharts';
import { TEAM_FLAGS } from '@/lib/flags';

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
  status: string;
};

type Prediction = {
  nation: string;
  predicted_mood: string;
  predicted_score: number;
  reasoning: string;
};

type ComparisonData = {
  predictions: Prediction[];
  actuals: Snapshot[];
};

export default function NationSentimentClient({ nation }: { nation: string }) {
  const [view, setView] = useState<'timeline' | 'journey'>('timeline');
  const [allSnapshots, setAllSnapshots] = useState<Snapshot[]>([]);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [matchOptions, setMatchOptions] = useState<{ matchId: string; label: string; date?: string }[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [generatingPrediction, setGeneratingPrediction] = useState(false);
  const positiveColor = '#10b981';
  const negativeColor = '#ef4444';

  const selectedMatch = matches.find((m) => String(m.id) === String(selectedMatchId));
  const matchIsFinished = selectedMatch?.status === 'FINISHED';

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadingMatches(true);
      try {
        const snapRes = await fetch(`/api/sentiment/nation?nation=${encodeURIComponent(nation)}`);
        const snaps = (await snapRes.json()) as Snapshot[];

        setAllSnapshots(Array.isArray(snaps) ? snaps : []);

        const uniqueMatchIds = Array.from(new Set(snaps?.map((s) => String(s.match_id)) ?? []));

        const matchDetailsArray = await Promise.all(
          uniqueMatchIds.map((matchId) =>
            fetch(`/api/football/match-events?match_id=${encodeURIComponent(matchId)}`)
              .then((res) => res.json())
              .then((data) => ({ matchId, ...data }))
              .catch(() => ({ matchId }))
          )
        );

        const options: { matchId: string; label: string; date?: string }[] = [];
        const matchSummaries: MatchSummary[] = [];

        matchDetailsArray.forEach((details) => {
          const homeTeam: string = details.homeTeam ?? '';
          const awayTeam: string = details.awayTeam ?? '';
          const utcDate: string | undefined = details.utcDate;
          const status: string = details.status ?? '';
          if (homeTeam && awayTeam) {
            options.push({ matchId: details.matchId, label: `${homeTeam} vs ${awayTeam}`, date: utcDate });
            matchSummaries.push({ id: details.matchId, homeTeam, awayTeam, utcDate: utcDate ?? '', status });
          }
        });

        options.sort((a, b) => {
          if (a.date && b.date) return new Date(a.date).getTime() - new Date(b.date).getTime();
          return a.matchId.localeCompare(b.matchId);
        });

        setMatchOptions(options);
        setMatches(matchSummaries);
        setLoadingMatches(false);
        if (options.length > 0) setSelectedMatchId(options[0].matchId);
      } catch (err) {
        console.error('Failed to load nation data', err);
        setLoadingMatches(false);
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

  useEffect(() => {
    if (!selectedMatchId) return;
    let mounted = true;
    async function loadComparison() {
      try {
        const mid = String(selectedMatchId);
        const resp = await fetch(`/api/predictions/compare?match_id=${encodeURIComponent(mid)}`);
        if (!mounted) return;
        const data = await resp.json();
        setComparisonData(data);
      } catch (err) {
        console.error('Failed to load comparison data', err);
        setComparisonData(null);
      }
    }
    loadComparison();
    return () => {
      mounted = false;
    };
  }, [selectedMatchId]);

  const handleGeneratePrediction = async () => {
    if (!selectedMatchId) return;
    const match = matches.find((m) => String(m.id) === String(selectedMatchId));
    if (!match) return;

    setGeneratingPrediction(true);
    try {
      const response = await fetch('/api/predictions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: String(selectedMatchId),
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
        }),
      });

      if (response.ok) {
        // Reload comparison data
        const comparisonResp = await fetch(
          `/api/predictions/compare?match_id=${encodeURIComponent(String(selectedMatchId))}`
        );
        const data = await comparisonResp.json();
        setComparisonData(data);
      }
    } catch (err) {
      console.error('Failed to generate prediction', err);
    } finally {
      setGeneratingPrediction(false);
    }
  };

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
    <div>
      <div className="max-w-4xl mx-auto">
        <div className="flex gap-2 mb-6">
          <button
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'timeline' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-300'}`}
            onClick={() => setView('timeline')}
          >
            Match Timeline
          </button>
          <button
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${view === 'journey' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-300'}`}
            onClick={() => setView('journey')}
          >
            Tournament Journey
          </button>
        </div>

        {view === 'timeline' ? (
          <div>
            <div className="mb-4">
              <label className="text-gray-400 text-sm">Select match</label>
              {loadingMatches ? (
                <span className="ml-2 text-gray-400 text-sm">Loading matches...</span>
              ) : (
                <select
                  className="ml-2 bg-gray-900 border border-gray-800 text-white rounded px-2 py-1"
                  value={selectedMatchId ?? ''}
                  onChange={(e) => setSelectedMatchId(e.target.value)}
                >
                  {matchOptions.map((o) => (
                    <option key={o.matchId} value={o.matchId}>{o.label}</option>
                  ))}
                </select>
              )}
            </div>

            {loading ? (
              <div>Loading…</div>
            ) : !timeline || timeline.length === 0 ? (
              <div className="text-gray-400">No sentiment data for this match yet</div>
            ) : (
              <div>
                <div className="border border-gray-800 rounded-2xl p-4">
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
                </div>

                {/* Pre-match prediction block - show when match is not finished and no prediction exists */}
                {!matchIsFinished && selectedMatch && (!comparisonData?.predictions || comparisonData.predictions.length === 0) && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mt-4">
                    <h3 className="text-lg font-semibold text-white mb-2">AI vs Reality</h3>
                    <p className="text-zinc-400 text-sm mb-3">Generate a pre-match prediction before kickoff. After the match, see how the AI compared to reality.</p>
                    <button
                      onClick={handleGeneratePrediction}
                      disabled={generatingPrediction}
                      className="bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {generatingPrediction ? 'Generating…' : 'Generate Pre-match Prediction'}
                    </button>
                  </div>
                )}

                {/* AI vs Reality Panel - only show when match is finished */}
                {matchIsFinished && (
                  <div className="mt-6 bg-gradient-to-br from-gray-900 to-gray-800/50 border border-gray-800 rounded-2xl p-4">
                    <h3 className="text-lg font-semibold text-white mb-4">AI vs Reality</h3>
                    {!comparisonData?.predictions || comparisonData.predictions.length === 0 ? (
                      <div>
                        <div className="text-gray-400 text-sm mb-3">No prediction yet for this match</div>
                        <button
                          onClick={handleGeneratePrediction}
                          disabled={generatingPrediction}
                          className="bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {generatingPrediction ? 'Generating…' : 'Generate Pre-match Prediction'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {comparisonData.predictions.map((pred) => {
                          const actual = comparisonData.actuals?.find((a) => a.nation === pred.nation);
                          const isCorrect = actual && actual.mood_label === pred.predicted_mood;
                          const hasActualData = !!actual;

                          return (
                            <div key={pred.nation} className="bg-gray-800 rounded p-3 border border-gray-700">
                              <div className="text-white font-semibold mb-2">{TEAM_FLAGS[pred.nation] ?? ''} {pred.nation}</div>
                              <div className="grid grid-cols-3 gap-2 text-sm">
                                <div>
                                  <div className="text-gray-400">AI Predicted</div>
                                  <div className="text-white">{pred.predicted_mood}</div>
                                  <div className="text-xs text-gray-500">{pred.predicted_score}</div>
                                  <div className="text-xs text-gray-400 mt-1">{pred.reasoning}</div>
                                </div>

                                <div className="flex flex-col justify-center items-center">
                                  {hasActualData ? (
                                    <div className={`text-xs font-semibold px-2 py-1 rounded ${isCorrect ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                                      {isCorrect ? '✓ Correct' : '✗ Wrong'}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-gray-500">—</div>
                                  )}
                                </div>

                                <div>
                                  <div className="text-gray-400">Actual</div>
                                  {hasActualData ? (
                                    <>
                                      <div className="text-white">{actual!.mood_label}</div>
                                      <div className="text-xs text-gray-500">{actual!.sentiment_score}</div>
                                    </>
                                  ) : (
                                    <div className="text-xs text-gray-500">—</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
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
