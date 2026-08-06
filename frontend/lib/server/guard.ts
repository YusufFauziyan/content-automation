import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

import { isSessionValid, SESSION_COOKIE } from './auth';

/**
 * The real guard.
 *
 * The middleware only checks that a cookie looks like a session, because the
 * edge runtime cannot verify the signature. Every page and route that reads
 * data calls this instead, where `node:crypto` is available and the signature
 * is actually checked.
 */
export async function requireSession(): Promise<void> {
  const store = await cookies();

  if (!isSessionValid(store.get(SESSION_COOKIE)?.value)) {
    redirect('/login');
  }
}

/**
 * The same check, for route handlers.
 *
 * Returns a reply to send when the caller is not admitted, and nothing when
 * they are — so a handler guards itself in two lines without a wrapper that
 * hides the early return.
 */
export async function requireApiSession(): Promise<NextResponse | null> {
  const store = await cookies();

  if (!isSessionValid(store.get(SESSION_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  }

  return null;
}
