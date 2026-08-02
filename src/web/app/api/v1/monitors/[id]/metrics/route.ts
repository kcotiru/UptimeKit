import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE_URL = process.env.EXPRESS_INTERNAL_API_URL || 'http://localhost:3000';

/**
 * API route handler proxy for retrieving time-series metrics.
 * @param request - Incoming request object with from and to query params
 * @param params - URL parameters object containing target monitor ID
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get('uptimekit_token')?.value;

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';

    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);

    const res = await fetch(
      `${API_BASE_URL}/api/v1/monitors/${params.id}/metrics?${query.toString()}`,
      {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }
    );

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
