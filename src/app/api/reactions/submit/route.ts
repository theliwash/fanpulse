// RLS: `user_reactions` table already has an INSERT policy enabled for authenticated users.
// Ensure the policy allows the server-side service role or the appropriate role to INSERT.

import { createServerClient } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { matchId, nation, reaction_text } = body ?? {};

    if (!matchId || typeof matchId !== 'string') {
      return NextResponse.json({ error: 'matchId (string) is required' }, { status: 400 });
    }

    if (!nation || typeof nation !== 'string' || nation.trim() === '') {
      return NextResponse.json({ error: 'nation is required' }, { status: 400 });
    }

    if (!reaction_text || typeof reaction_text !== 'string') {
      return NextResponse.json({ error: 'reaction_text is required' }, { status: 400 });
    }

    const text = reaction_text.trim();
    if (text.length < 5 || text.length > 200) {
      return NextResponse.json({ error: 'reaction_text must be between 5 and 200 characters' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('user_reactions')
      .insert([
        {
          match_id: String(matchId),
          nation: nation.trim(),
          reaction_text: text,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'Failed to insert reaction' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('Reaction submit error:', err);
    return NextResponse.json({ error: 'Failed to submit reaction' }, { status: 500 });
  }
}
