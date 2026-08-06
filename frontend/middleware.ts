import { NextResponse, type NextRequest } from 'next/server';

import { looksLikeSession } from '@/lib/auth-edge';

const SESSION_COOKIE = 'yu_session';

/** Paths reachable without a session. Everything else needs one. */
const PUBLIC = ['/', '/login'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = looksLikeSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (signedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (PUBLIC.includes(pathname) || signedIn) {
    return NextResponse.next();
  }

  // Remember where they were headed, so signing in continues the journey
  // instead of dumping them on the dashboard.
  const login = new URL('/login', request.url);
  if (pathname !== '/dashboard') {
    login.searchParams.set('next', pathname);
  }

  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's own assets and the auth endpoints, which have to
  // stay reachable in order to create a session in the first place.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
