import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const matchId = searchParams.get('match_id');

    if (!matchId) {
      return NextResponse.json(
        { error: 'Missing match_id query parameter' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch predictions for this match
    const { data: predictions, error: predictError } = await supabase
      .from('match_predictions')
      .select('*')
      .eq('match_id', matchId);

    if (predictError) {
      console.error('Error fetching predictions:', predictError);
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }

    // Fetch latest sentiment snapshots for this match (one per nation)
    const { data: allSnapshots, error: snapError } = await supabase
      .from('sentiment_snapshots')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: false });

    if (snapError) {
      console.error('Error fetching snapshots:', snapError);
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }

    // Get latest snapshot per nation
    const latestByNation = new Map<string, typeof allSnapshots[0]>();
    for (const snap of allSnapshots || []) {
      if (!latestByNation.has(snap.nation)) {
        latestByNation.set(snap.nation, snap);
      }
    }

    const actuals = Array.from(latestByNation.values());

    return NextResponse.json({
      predictions: predictions || [],
      actuals,
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
