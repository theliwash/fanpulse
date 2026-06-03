"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  FootballMatchSummary,
  MatchEventsResponse,
  MatchGoalEvent,
} from "@/lib/football-types";

const MIN_COMMENT_LENGTH = 10;
const MAX_COMMENTS = 50;

type RedditListingChild = {
  kind: string;
  data: RedditCommentData;
};

type RedditCommentData = {
  body?: string;
  replies?: "" | RedditRepliesListing;
};

type RedditRepliesListing = {
  kind: string;
  data: {
    children: RedditListingChild[];
  };
};

type RedditCommentsResponse = [
  unknown,
  {
    data: {
      children: RedditListingChild[];
    };
  },
];

function extractCommentBodies(children: RedditListingChild[]): string[] {
  const bodies: string[] = [];

  for (const child of children) {
    if (child.kind !== "t1") continue;

    const body = child.data.body?.trim();
    if (body && body.length >= MIN_COMMENT_LENGTH) {
      bodies.push(body);
    }

    const replies = child.data.replies;
    if (replies && typeof replies === "object" && replies.data?.children) {
      bodies.push(...extractCommentBodies(replies.data.children));
    }
  }

  return bodies;
}

function parseRedditComments(json: unknown): string[] {
  if (!Array.isArray(json) || json.length < 2) {
    throw new Error("Unexpected Reddit API response format");
  }

  const commentListing = json[1] as RedditCommentsResponse[1];
  const children = commentListing?.data?.children ?? [];
  return extractCommentBodies(children).slice(0, MAX_COMMENTS);
}

function formatScore(score: FootballMatchSummary["score"]): string {
  if (!score) return "– : –";
  const home = score.home ?? "–";
  const away = score.away ?? "–";
  return `${home} : ${away}`;
}

function formatMatchDate(utcDate: string): string {
  return new Date(utcDate).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

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

export default function TestRedditPage() {
  const [threadId, setThreadId] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const [redditLoading, setRedditLoading] = useState(false);
  const [redditError, setRedditError] = useState<string | null>(null);

  const [matches, setMatches] = useState<FootballMatchSummary[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState<string | null>(null);

  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [matchEvents, setMatchEvents] = useState<MatchEventsResponse | null>(
    null
  );
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

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
    } catch (err) {
      setMatches([]);
      setMatchesError(
        err instanceof Error ? err.message : "Failed to load matches"
      );
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  async function handleSelectMatch(matchId: number) {
    setSelectedMatchId(matchId);
    setMatchEvents(null);
    setEventsLoading(true);
    setEventsError(null);

    try {
      const params = new URLSearchParams({ match_id: String(matchId) });
      const response = await fetch(
        `/api/football/match-events?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as MatchEventsResponse;
      setMatchEvents(data);
    } catch (err) {
      setEventsError(
        err instanceof Error ? err.message : "Failed to load match events"
      );
    } finally {
      setEventsLoading(false);
    }
  }

  async function handleFetchComments() {
    const id = threadId.trim();
    if (!id) {
      setRedditError("Enter a Reddit thread ID");
      setComments([]);
      return;
    }

    setRedditLoading(true);
    setRedditError(null);
    setComments([]);

    try {
      const url = `https://www.reddit.com/r/soccer/comments/${encodeURIComponent(id)}.json?limit=100`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Reddit returned ${response.status}`);
      }

      const json: unknown = await response.json();
      setComments(parseRedditComments(json));
    } catch (err) {
      setRedditError(
        err instanceof Error ? err.message : "Failed to fetch comments"
      );
    } finally {
      setRedditLoading(false);
    }
  }

  const selectedMatch = matches.find((m) => m.id === selectedMatchId);
  const goals: MatchGoalEvent[] = matchEvents?.goals ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 p-8">
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">World Cup Matches</h1>

        {matchesLoading && (
          <p className="text-sm text-neutral-600" role="status">
            Loading matches…
          </p>
        )}

        {matchesError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {matchesError}
          </p>
        )}

        {!matchesLoading && !matchesError && matches.length === 0 && (
          <p className="text-sm text-neutral-500">No matches available.</p>
        )}

        {!matchesLoading && matches.length > 0 && (
          <ul className="flex flex-col gap-3">
            {matches.map((match) => {
              const isSelected = selectedMatchId === match.id;
              return (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectMatch(match.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      isSelected
                        ? "border-blue-500 bg-blue-500/10 ring-1 ring-blue-500"
                        : "border-neutral-700 hover:border-neutral-400"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {match.homeTeam} vs {match.awayTeam}
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
                        {formatScore(match.score)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-sm text-neutral-600">
                      <span>{match.status}</span>
                      <span>{formatMatchDate(match.utcDate)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selectedMatch && (
          <div className="rounded-lg border border-neutral-700 bg-neutral-900/40 p-4">
            <h2 className="text-base font-semibold text-neutral-100">
              Match events
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              {selectedMatch.homeTeam} vs {selectedMatch.awayTeam}
            </p>

            {eventsLoading && (
              <p className="mt-4 text-sm text-neutral-300" role="status">
                Loading events…
              </p>
            )}

            {eventsError && (
              <p className="mt-4 rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
                {eventsError}
              </p>
            )}

            {!eventsLoading && !eventsError && matchEvents && (
              <div className="mt-4">
                <p className="text-sm text-neutral-300">
                  Status:{" "}
                  <span className="font-medium text-neutral-100">
                    {matchEvents.status}
                  </span>
                </p>
                {goals.length === 0 ? (
                  <p className="mt-4 text-sm text-neutral-300">
                    No events yet
                  </p>
                ) : (
                  <ol className="mt-4 space-y-3 border-l-2 border-neutral-600 pl-4">
                    {goals.map((goal, index) => (
                      <li key={`${goal.minute}-${goal.scorer}-${index}`}>
                        <span className="text-xs font-medium text-neutral-400">
                          {goal.minute}&apos;
                        </span>
                        <p className="text-sm text-neutral-100">
                          <span className="font-medium">{goal.scorer}</span>
                          <span className="text-neutral-400">
                            {" "}
                            — {goal.team}
                          </span>
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

          </div>
        )}
      </section>

      <section className="flex flex-col gap-4 border-t border-neutral-200 pt-8">
        <h2 className="text-xl font-semibold">Reddit Comment Fetch Test</h2>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium text-neutral-600">
              Reddit thread ID
            </span>
            <input
              type="text"
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
              placeholder="e.g. abc123"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
              disabled={redditLoading}
            />
          </label>
          <button
            type="button"
            onClick={handleFetchComments}
            disabled={redditLoading}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {redditLoading ? "Fetching…" : "Fetch Comments"}
          </button>
        </div>

        {redditLoading && (
          <p className="text-sm text-neutral-600" role="status">
            Loading comments…
          </p>
        )}

        {redditError && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {redditError}
          </p>
        )}

        {!redditLoading && comments.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-neutral-600">
              {comments.length} comment{comments.length === 1 ? "" : "s"}
            </p>
            <ul className="max-h-[60vh] space-y-3 overflow-y-auto rounded-md border border-neutral-200 p-4">
              {comments.map((comment, index) => (
                <li
                  key={`${index}-${comment.slice(0, 24)}`}
                  className="border-b border-neutral-100 pb-3 text-sm last:border-0 last:pb-0"
                >
                  {comment}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!redditLoading &&
          !redditError &&
          comments.length === 0 &&
          threadId.trim() === "" && (
            <p className="text-sm text-neutral-500">
              Enter a thread ID from an r/soccer post URL and fetch comments.
            </p>
          )}
      </section>
    </main>
  );
}
