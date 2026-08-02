import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE_URL = process.env.EXPRESS_INTERNAL_API_URL || 'http://localhost:3000';

/**
 * API route handler proxy for retrieving team monitors list.
 */
export async function GET() {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get('uptimekit_token')?.value;

    const res = await fetch(`${API_BASE_URL}/api/v1/monitors`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * API route handler proxy for creating a new HTTP health monitor.
 * @param request - JSON request body containing monitor configuration
 */
export async function POST(request: Request) {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get('uptimekit_token')?.value;
    const body = await request.json();

    const res = await fetch(`${API_BASE_URL}/api/v1/monitors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
