import { createServerClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const matchId = request.nextUrl.searchParams.get('match_id') ?? '';
    const nation = request.nextUrl.searchParams.get('nation') ?? '';
    if (!matchId || !nation) {
      return NextResponse.json({ error: 'match_id and nation query params are required' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('sentiment_snapshots')
      .select('id, match_id, nation, sentiment_score, mood_label, top_emotion, key_talking_point, created_at')
      .eq('match_id', matchId)
      .eq('nation', nation)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase error (match-timeline):', error);
      return NextResponse.json({ error: 'Failed to load snapshots' }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error('Match timeline error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
