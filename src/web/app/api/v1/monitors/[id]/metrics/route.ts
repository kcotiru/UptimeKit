import { NextResponse } from 'next/server';
import { getMetrics } from '@/lib/monitors';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns time-series ping metrics for a monitor, defaulting to the last 24 hours.
 * @param request - Incoming request with optional from and to ISO query params
 * @param params - URL parameters object containing target monitor ID
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(request.url);
    const to = searchParams.get('to') || new Date().toISOString();
    const from = searchParams.get('from') || new Date(Date.parse(to) - DAY_MS).toISOString();

    const metrics = await getMetrics(params.id, from, to);
    return NextResponse.json({ success: true, data: { monitorId: params.id, metrics } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
