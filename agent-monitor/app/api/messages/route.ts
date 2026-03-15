import { NextResponse } from 'next/server';
import { getMessageUsageRecords } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('execution_id');

    if (!executionId) {
      return NextResponse.json({ error: 'execution_id is required' }, { status: 400 });
    }

    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const records = getMessageUsageRecords(executionId, limit, offset);

    return NextResponse.json({ records });
  } catch (error) {
    console.error('Error fetching message usage records:', error);
    return NextResponse.json({ error: 'Failed to fetch message usage records' }, { status: 500 });
  }
}
