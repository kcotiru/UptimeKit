import { NextResponse } from 'next/server';

/**
 * Negotiates and sets the HttpOnly JWT session cookie on an outgoing NextResponse.
 * @param response - Next.js response object
 * @param token - JWT token string
 */
export function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set('uptimekit_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  });
}
