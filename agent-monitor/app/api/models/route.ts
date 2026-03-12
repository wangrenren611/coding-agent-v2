import { NextResponse } from 'next/server';
import { getTokenUsageByModel, getTokenUsageByExecution } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    if (type === 'by-execution') {
      const byExecution = getTokenUsageByExecution();
      return NextResponse.json({ byExecution });
    }

    const byModel = getTokenUsageByModel();
    return NextResponse.json({ byModel });
  } catch (error) {
    console.error('Error fetching model stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch model stats' },
      { status: 500 }
    );
  }
}
