import { createServerClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

interface Goal {
  minute: number;
  scorer: string;
  team: string;
}

interface UserReaction {
  nation: string;
  reaction_text: string;
}

interface SentimentResult {
  nation: string;
  sentiment_score: number;
  mood_label: string;
  top_emotion: string;
  key_talking_point: string;
}

const ALLOWED_MOODS = [
  'Euphoric',
  'Confident',
  'Nervous',
  'Frustrated',
  'Devastated',
  'Furious',
  'Neutral',
] as const;

function isValidSentiment(obj: unknown): obj is SentimentResult {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.nation === 'string' &&
    typeof o.sentiment_score === 'number' &&
    Number.isFinite(o.sentiment_score) &&
    typeof o.mood_label === 'string' &&
    (ALLOWED_MOODS as readonly string[]).includes(o.mood_label as string) &&
    typeof o.top_emotion === 'string' &&
    typeof o.key_talking_point === 'string'
  );
}

function safeParseJsonArray(input: string): unknown[] {
  const cleaned = input.replace(/```json|```/g, '').trim();

  // Try to locate the first '[' and the last ']' to extract the JSON array
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  const candidate = first !== -1 && last !== -1 ? cleaned.slice(first, last + 1) : cleaned;

  return JSON.parse(candidate) as unknown[];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { matchId, homeTeam, awayTeam, status, goals = [], userReactions = [], homeScore, awayScore, emojiCounts } = body ?? {};

    if (!matchId || typeof matchId !== 'string') {
      return NextResponse.json({ error: 'matchId (string) is required' }, { status: 400 });
    }

    if (!homeTeam || !awayTeam || typeof homeTeam !== 'string' || typeof awayTeam !== 'string') {
      return NextResponse.json({ error: 'homeTeam and awayTeam (strings) are required' }, { status: 400 });
    }

    const goalsText = Array.isArray(goals) && goals.length > 0
      ? goals.map((g: Goal) => `${g.minute}' - ${g.scorer} (${g.team})`).join(', ')
      : null;

    const scoreText = goalsText == null && homeScore != null && awayScore != null
      ? `Final score: ${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}`
      : null;

    const matchInfo = [
      `Match: ${homeTeam} vs ${awayTeam}`,
      `Status: ${status}`,
      scoreText || `Goals: ${goalsText || 'No goals yet'}`,
    ].join('\n');

    const reactionsText = Array.isArray(userReactions) && userReactions.length > 0
      ? userReactions.map((r: UserReaction) => `${r.nation}: ${r.reaction_text}`).join('\n')
      : 'None yet';

    const emojiLine = (() => {
      if (!emojiCounts || typeof emojiCounts !== 'object') return '';
      const ec = emojiCounts as Record<string, number>;
      const hasAny = Object.values(ec).some((v) => typeof v === 'number' && v > 0);
      if (!hasAny) return '';
      return `Fan emoji reactions: 🔥 ${ec.fire ?? 0}, 😱 ${ec.shocked ?? 0}, 😭 ${ec.sad ?? 0}, 😤 ${ec.angry ?? 0}, 🎉 ${ec.party ?? 0}`;
    })();

    const promptParts = [matchInfo, `User reactions: ${reactionsText}`];
    if (emojiLine) promptParts.push(emojiLine);
    promptParts.push('\nConsider football context fans would recognise: if a stronger or favoured team only draws or loses against a clearly weaker opponent, that is an underperformance and should be reflected as Frustrated or Devastated, not Neutral. If a weaker team draws or wins against a stronger opponent, that is an overperformance and should be reflected as Confident or Euphoric. The mood_label must be consistent with top_emotion: do not select Neutral if top_emotion expresses any positive or negative feeling such as disappointment, relief, anger, or joy.\n\nReturn a JSON array with one object per team containing:\n- nation (string)\n- sentiment_score (integer -100 to 100)\n- mood_label (one of: Euphoric, Confident, Nervous, Frustrated, Devastated, Furious, Neutral)\n- top_emotion (single word)\n- key_talking_point (max 12 words)\n\nONLY return the JSON array. No explanation, no markdown.');

    const userPrompt = promptParts.join('\n');

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
    }

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a football fan sentiment analyst covering the 2026 FIFA World Cup. Analyse the match situation and return ONLY a valid JSON array. No explanation, no markdown, no preamble.'
          },
          {
            role: 'user',
            content: userPrompt,
          }
        ],
        temperature: 0.7,
      }),
    });

    if (!groqResponse.ok) {
      let errorBody: unknown = { message: 'Groq API error' };
      try {
        errorBody = await groqResponse.json();
      } catch {
        // ignore
      }
      let msg: string | undefined;
      if (typeof errorBody === 'object' && errorBody !== null) {
        const eb = errorBody as Record<string, unknown>;
        const nested = eb.error;
        if (nested && typeof nested === 'object' && nested !== null) {
          const m = (nested as Record<string, unknown>).message;
          if (typeof m === 'string') msg = m;
        }
        if (!msg && typeof eb.message === 'string') msg = eb.message;
      }
      return NextResponse.json({ error: msg || 'Groq API error' }, { status: 502 });
    }

    const groqData = await groqResponse.json();

    // Support both chat completions and variations in the API response shape
    const rawContent = groqData?.choices?.[0]?.message?.content ?? groqData?.choices?.[0]?.text ?? JSON.stringify(groqData);

    let parsed: unknown;
    try {
      parsed = safeParseJsonArray(String(rawContent));
    } catch {
      console.error('Failed to parse model output:', rawContent);
      return NextResponse.json({ error: 'Failed to parse model output' }, { status: 502 });
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Model output is not a JSON array' }, { status: 502 });
    }

    const sentimentArray: SentimentResult[] = [];
    for (const item of parsed as unknown[]) {
      if (!isValidSentiment(item)) {
        console.warn('Invalid sentiment item, skipping', item);
        continue;
      }

      // Normalize sentiment_score to integer and clamp to [-100, 100]
      const score = Math.max(-100, Math.min(100, Math.round(item.sentiment_score)));

      sentimentArray.push({
        nation: item.nation,
        sentiment_score: score,
        mood_label: item.mood_label,
        top_emotion: item.top_emotion,
        key_talking_point: item.key_talking_point,
      });
    }

    if (sentimentArray.length === 0) {
      return NextResponse.json({ error: 'No valid sentiment results returned by model' }, { status: 502 });
    }

    const supabase = createServerClient();
    const rows = sentimentArray.map((result) => ({
      match_id: String(matchId),
      nation: result.nation,
      sentiment_score: result.sentiment_score,
      mood_label: result.mood_label,
      top_emotion: result.top_emotion,
      key_talking_point: result.key_talking_point,
      comment_count: Array.isArray(userReactions) ? userReactions.length : 0,
      source: 'reddit',
    }));

    const { error: insertError } = await supabase.from('sentiment_snapshots').insert(rows);

    if (insertError) {
      console.error('Supabase insert error:', insertError);
      return NextResponse.json({ error: 'Failed to store sentiment snapshots' }, { status: 500 });
    }

    return NextResponse.json(sentimentArray);
  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return NextResponse.json({ error: 'Failed to analyse sentiment' }, { status: 500 });
  }
}
