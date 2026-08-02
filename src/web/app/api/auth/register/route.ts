import { NextResponse } from 'next/server';
import { setAuthCookie } from '@/lib/auth-cookie';

const API_BASE_URL = process.env.EXPRESS_INTERNAL_API_URL || 'http://localhost:3000';

/**
 * Route handler proxy for team user registration.
 * Proxies account credentials to Express API and sets HttpOnly JWT cookie on success.
 * @param request - Next.js Request object with JSON body containing email, password, and teamName
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, teamName } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const expressRes = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, teamName }),
    });

    const data = await expressRes.json();

    if (!expressRes.ok || !data.success) {
      return NextResponse.json(
        { success: false, error: data.error || data.message || 'Registration failed' },
        { status: expressRes.status || 400 }
      );
    }

    const token = data.token || (data.data && data.data.token);

    const response = NextResponse.json({
      success: true,
      user: data.user || (data.data && data.data.user),
    });

    if (token) {
      setAuthCookie(response, token);
    }

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
