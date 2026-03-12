import { NextResponse } from 'next/server';
import { getErrorLogs, getLogsByExecution } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const executionId = searchParams.get('execution_id');

    if (executionId) {
      const logs = getLogsByExecution(executionId).filter(l => l.level === 'error');
      return NextResponse.json({ logs });
    }

    const logs = getErrorLogs(limit);
    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching errors:', error);
    return NextResponse.json({ error: 'Failed to fetch errors' }, { status: 500 });
  }
}
