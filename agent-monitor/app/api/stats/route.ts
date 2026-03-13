import { NextResponse } from 'next/server';
import {
  getAggregateStats,
  getDailyStats,
  getModelUsage,
  getRunStats,
} from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const executionId = searchParams.get('execution_id');

    if (executionId) {
      const stats = getRunStats(executionId);
      return NextResponse.json({ stats });
    }

    if (type === 'daily') {
      const days = parseInt(searchParams.get('days') || '7');
      const daily_stats = getDailyStats(days);
      return NextResponse.json({ daily_stats });
    }

    if (type === 'models') {
      const model_usage = getModelUsage();
      return NextResponse.json({ model_usage });
    }

    const stats = getAggregateStats();
    return NextResponse.json({ stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
