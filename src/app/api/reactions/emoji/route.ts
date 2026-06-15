import { createServerClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

type EmojiType = 'fire' | 'shocked' | 'sad' | 'angry' | 'party';

const VALID_EMOJIS = new Set<EmojiType>(['fire', 'shocked', 'sad', 'angry', 'party']);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { matchId, emoji } = body ?? {};

    if (!matchId || typeof matchId !== 'string') {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    if (!emoji || !VALID_EMOJIS.has(emoji as EmojiType)) {
      return NextResponse.json({ error: 'Invalid emoji type' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { error } = await supabase.from('user_reactions').insert({
      match_id: matchId,
      nation: emoji,
      reaction_text: emoji,
      included_in_analysis: false,
    });

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'Failed to save reaction' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Emoji reaction error:', err);
    return NextResponse.json({ error: 'Failed to process reaction' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const matchId = request.nextUrl.searchParams.get('matchId');

    if (!matchId) {
      return NextResponse.json({ error: 'matchId is required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('user_reactions')
      .select('nation')
      .eq('match_id', matchId);

    if (error) {
      console.error('Supabase query error:', error);
      return NextResponse.json({ error: 'Failed to fetch reactions' }, { status: 500 });
    }

    const counts: Record<EmojiType, number> = {
      fire: 0,
      shocked: 0,
      sad: 0,
      angry: 0,
      party: 0,
    };

    if (Array.isArray(data)) {
      for (const row of data) {
        const nation = row.nation as string;
        if (VALID_EMOJIS.has(nation as EmojiType)) {
          counts[nation as EmojiType]++;
        }
      }
    }

    return NextResponse.json(counts);
  } catch (err) {
    console.error('Emoji query error:', err);
    return NextResponse.json({ error: 'Failed to fetch reactions' }, { status: 500 });
  }
}
