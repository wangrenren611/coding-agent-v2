import { NextResponse } from 'next/server';
import {
  getAggregateStats,
  getTokenUsageByDay,
  getStatusDistribution,
  getRunStats,
} from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const executionId = searchParams.get('execution_id');
    const days = parseInt(searchParams.get('days') || '7');

    if (executionId) {
      const stats = getRunStats(executionId);
      return NextResponse.json({ stats });
    }

    if (type === 'daily') {
      const daily = getTokenUsageByDay(days);
      return NextResponse.json({ daily });
    }

    if (type === 'distribution') {
      const distribution = getStatusDistribution();
      return NextResponse.json({ distribution });
    }

    const aggregate = getAggregateStats();
    return NextResponse.json({ aggregate });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
