export type FootballMatchSummary = {
  id: number;
  homeTeam: string | null;
  awayTeam: string | null;
  status: string;
  score: { home: number | null; away: number | null } | null;
  utcDate: string;
};

export type MatchGoalEvent = {
  minute: number;
  scorer: string;
  team: string;
};

export type MatchEventsResponse = {
  status: string;
  goals: MatchGoalEvent[];
  homeTeam: string;
  awayTeam: string;
  utcDate: string;
};
