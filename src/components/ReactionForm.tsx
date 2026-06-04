"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  onReactionSubmitted?: (row: any) => void;
}

const NATIONS = [
  'Argentina','Australia','Belgium','Brazil','Canada','Chile','Colombia','Costa Rica','Croatia','Czech Republic',
  'Denmark','Ecuador','England','France','Germany','Ghana','Iran','Japan','Mexico','Morocco',
  'Netherlands','New Zealand','Nigeria','Norway','Panama','Paraguay','Peru','Poland','Portugal','Republic of Ireland',
  'Romania','Scotland','Serbia','Senegal','Saudi Arabia','Slovakia','Slovenia','South Korea','Spain','Sweden',
  'Switzerland','Tunisia','Turkey','Ukraine','United States','Uruguay','Wales','Hungary'
];

export default function ReactionForm({ matchId, homeTeam, awayTeam, onReactionSubmitted }: Props) {
  const [nation, setNation] = useState<string>(homeTeam ?? "");
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);

    if (!nation || nation.trim() === "") {
      setError("Please select a nation");
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length < 5 || trimmed.length > 200) {
      setError("Reaction must be between 5 and 200 characters");
      return;
    }

    setLoading(true);

    try {
      const resp = await fetch("/api/reactions/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, nation, reaction_text: trimmed }),
      });

      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json?.error || "Submission failed");
      }

      setSuccess(true);
      setText("");
      onReactionSubmitted?.(json);

      // Reset success after 3 seconds
      timeoutRef.current = window.setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-neutral-700 bg-neutral-900/30 p-4">
      <div className="mb-3">
        <label className="block text-sm font-medium text-neutral-200">Nation</label>
        <select
          value={nation}
          onChange={(e) => setNation(e.target.value)}
          className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-100"
        >
          <option value="">Select nation</option>
          {NATIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-200">Reaction</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          rows={3}
          className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-100"
          placeholder="Share a short fan reaction (5-200 characters)"
        />
        <div className="mt-1 text-xs text-neutral-400">{text.length}/200</div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Submitting…" : "Submit Reaction"}
        </button>

        {success && <div className="text-sm text-emerald-400">Submitted!</div>}
        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>
    </form>
  );
}
