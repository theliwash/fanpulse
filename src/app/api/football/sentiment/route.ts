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

function isValidSentiment(obj: any): obj is SentimentResult {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.nation === 'string' &&
    typeof obj.sentiment_score === 'number' &&
    Number.isFinite(obj.sentiment_score) &&
    typeof obj.mood_label === 'string' &&
    ALLOWED_MOODS.includes(obj.mood_label) &&
    typeof obj.top_emotion === 'string' &&
    typeof obj.key_talking_point === 'string'
  );
}

function safeParseJsonArray(input: string): any[] {
  const cleaned = input.replace(/```json|```/g, '').trim();

  // Try to locate the first '[' and the last ']' to extract the JSON array
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  const candidate = first !== -1 && last !== -1 ? cleaned.slice(first, last + 1) : cleaned;

  return JSON.parse(candidate);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { matchId, homeTeam, awayTeam, status, goals = [], userReactions = [] } = body ?? {};

    if (!matchId || typeof matchId !== 'string') {
      return NextResponse.json({ error: 'matchId (string) is required' }, { status: 400 });
    }

    if (!homeTeam || !awayTeam || typeof homeTeam !== 'string' || typeof awayTeam !== 'string') {
      return NextResponse.json({ error: 'homeTeam and awayTeam (strings) are required' }, { status: 400 });
    }

    const goalsText = Array.isArray(goals) && goals.length > 0
      ? goals.map((g: Goal) => `${g.minute}' - ${g.scorer} (${g.team})`).join(', ')
      : 'No goals yet';

    const reactionsText = Array.isArray(userReactions) && userReactions.length > 0
      ? userReactions.map((r: UserReaction) => `${r.nation}: ${r.reaction_text}`).join('\n')
      : 'None yet';

    const userPrompt = `Match: ${homeTeam} vs ${awayTeam}\nStatus: ${status}\nGoals: ${goalsText}\nUser reactions: ${reactionsText}\n\nReturn a JSON array with one object per team containing:\n- nation (string)\n- sentiment_score (integer -100 to 100)\n- mood_label (one of: Euphoric, Confident, Nervous, Frustrated, Devastated, Furious, Neutral)\n- top_emotion (single word)\n- key_talking_point (max 12 words)\n\nONLY return the JSON array. No explanation, no markdown.`;

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
      let errorBody: any = { message: 'Groq API error' };
      try {
        errorBody = await groqResponse.json();
      } catch (e) {
        // ignore
      }
      return NextResponse.json({ error: errorBody.error?.message || errorBody.message || 'Groq API error' }, { status: 502 });
    }

    const groqData = await groqResponse.json();

    // Support both chat completions and variations in the API response shape
    const rawContent = groqData?.choices?.[0]?.message?.content ?? groqData?.choices?.[0]?.text ?? JSON.stringify(groqData);

    let parsed: any;
    try {
      parsed = safeParseJsonArray(String(rawContent));
    } catch (e) {
      console.error('Failed to parse model output:', rawContent);
      return NextResponse.json({ error: 'Failed to parse model output' }, { status: 502 });
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Model output is not a JSON array' }, { status: 502 });
    }

    const sentimentArray: SentimentResult[] = [];
    for (const item of parsed) {
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
