import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Parses unverified JWT token payload to inspect expiration claim.
 * @param token - Raw JWT token string
 * @returns Decoded payload object or null
 */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Next.js Edge Middleware protecting /dashboard/* routes by validating session cookie presence and expiration.
 * @param request - Incoming NextRequest object
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('uptimekit_token')?.value;

  let isValidToken = false;

  if (token) {
    const payload = decodeJwtPayload(token);
    if (payload && payload.exp) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      isValidToken = payload.exp > nowSeconds;
    } else {
      isValidToken = true; // Fallback if no exp claim in token payload
    }
  }

  // Protect /dashboard/* routes
  if (pathname.startsWith('/dashboard')) {
    if (!isValidToken) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const response = NextResponse.redirect(loginUrl);
      if (token && !isValidToken) {
        response.cookies.set('uptimekit_token', '', { maxAge: 0, path: '/' });
      }
      return response;
    }
  }

  // Redirect authenticated users away from auth pages (/login, /register)
  if (isValidToken && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/dashboard/monitors', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login', '/register'],
};
