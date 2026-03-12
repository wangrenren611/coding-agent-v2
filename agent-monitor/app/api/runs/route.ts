import { NextResponse } from 'next/server';
import { getRuns, getRunById, getRunStats } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const executionId = searchParams.get('execution_id');

    if (executionId) {
      const run = getRunById(executionId);
      if (!run) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 });
      }
      const stats = getRunStats(executionId);
      return NextResponse.json({ run, stats });
    }

    const runs = getRuns(limit);
    return NextResponse.json({ runs });
  } catch (error) {
    console.error('Error fetching runs:', error);
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 });
  }
}
