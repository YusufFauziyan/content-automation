import { NextResponse } from 'next/server';

import { createSession, isPasswordCorrect, SESSION_COOKIE } from '@/lib/server/auth';

export const dynamic = 'force-dynamic';

/** A wrong password costs this long, which makes guessing tedious. */
const WRONG_PASSWORD_DELAY_MS = 600;

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };

  if (typeof password !== 'string' || password === '') {
    return NextResponse.json({ error: 'Enter the password.' }, { status: 400 });
  }

  if (!isPasswordCorrect(password)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return NextResponse.json({ error: 'That password is not right.' }, { status: 401 });
  }

  const session = createSession();
  const response = NextResponse.json({ ok: true });

  response.cookies.set(SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: session.maxAge,
  });

  return response;
}
