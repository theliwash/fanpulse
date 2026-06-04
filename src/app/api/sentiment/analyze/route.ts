import { NextRequest } from 'next/server';
import { POST as analyzeFootball } from '@/app/api/football/sentiment/route';

export async function POST(request: NextRequest) {
  // Forward the incoming request to the existing football sentiment handler
  return analyzeFootball(request as any);
}
