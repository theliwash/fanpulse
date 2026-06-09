import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

type PredictionRequest = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
};

type PredictionResponse = {
  nation: string;
  predicted_mood: string;
  predicted_score: number;
  reasoning: string;
}[];

export async function POST(request: NextRequest) {
  try {
    const body: PredictionRequest = await request.json();
    const { matchId, homeTeam, awayTeam } = body;

    if (!matchId || !homeTeam || !awayTeam) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Check if predictions already exist for this match
    const { data: existingPredictions, error: fetchError } = await supabase
      .from('match_predictions')
      .select('*')
      .eq('match_id', matchId);

    if (fetchError) {
      console.error('Error fetching existing predictions:', fetchError);
      return NextResponse.json(
        { error: 'Database error' },
        { status: 500 }
      );
    }

    if (existingPredictions && existingPredictions.length > 0) {
      // Return existing predictions
      return NextResponse.json(existingPredictions);
    }

    // Generate new predictions using Groq API
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return NextResponse.json(
        { error: 'Groq API key not configured' },
        { status: 500 }
      );
    }

    const prompt = `Predict pre-match fan sentiment for ${homeTeam} vs ${awayTeam} in the 2026 World Cup. Return a JSON array with two objects, one per team: { nation, predicted_mood (one of: Euphoric/Confident/Nervous/Frustrated/Neutral), predicted_score (integer -100 to 100), reasoning (max 15 words) }`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a football analyst. Return ONLY valid JSON, no markdown, no explanation.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!groqResponse.ok) {
      const error = await groqResponse.text();
      console.error('Groq API error:', error);
      return NextResponse.json(
        { error: 'Failed to generate predictions' },
        { status: 500 }
      );
    }

    const groqData = await groqResponse.json();
    const content = groqData.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    let predictions: PredictionResponse;
    try {
      predictions = JSON.parse(content);
    } catch {
      console.error('Failed to parse Groq response:', content);
      return NextResponse.json(
        { error: 'Failed to parse AI predictions' },
        { status: 500 }
      );
    }

    // Validate predictions array
    if (!Array.isArray(predictions) || predictions.length !== 2) {
      return NextResponse.json(
        { error: 'Invalid prediction format' },
        { status: 500 }
      );
    }

    // Save predictions to database
    const savePredictions = predictions.map((pred) => ({
      match_id: matchId,
      nation: pred.nation,
      predicted_mood: pred.predicted_mood,
      predicted_score: pred.predicted_score,
      reasoning: pred.reasoning,
    }));

    const { data: savedPredictions, error: saveError } = await supabase
      .from('match_predictions')
      .insert(savePredictions)
      .select();

    if (saveError) {
      console.error('Error saving predictions:', saveError);
      return NextResponse.json(
        { error: 'Failed to save predictions' },
        { status: 500 }
      );
    }

    return NextResponse.json(savedPredictions);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
