export interface Match {
  id: string;
  team_a: string;
  team_b: string;
  kickoff_time: string;
  status: "upcoming" | "live" | "finished";
  reddit_thread_id: string;
}

export interface SentimentSnapshot {
  id: string;
  created_at: string;
  match_id: string;
  nation: string;
  sentiment_score: number;
  mood_label: string;
  top_emotion: string;
  key_talking_point: string;
  comment_count: number;
}

export interface UserReaction {
  id: string;
  created_at: string;
  nation: string;
  reaction_text: string;
  match_id: string;
}
