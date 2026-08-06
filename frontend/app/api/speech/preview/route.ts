import { NextResponse } from 'next/server';

import { requireApiSession } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

const BASE_URL = (process.env.ROUTER_SPEECH_BASE_URL ?? 'https://router.fauzyan.my.id/v1').replace(
  /\/+$/,
  '',
);
const API_KEY = process.env.ROUTER_SPEECH_API_KEY ?? '';
const MODEL_PREFIX = process.env.ROUTER_SPEECH_MODEL_PREFIX ?? 'google-tts';

/** Long enough to hear the voice, short enough to be instant. */
const SAMPLE = 'This is how your narration will sound.';

/**
 * A spoken sample of one language.
 *
 * The key never reaches the browser: the request is made here and only the
 * audio goes back. Same reason the media route exists — the browser is given
 * bytes, not credentials.
 */
export async function GET(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const language = new URL(request.url).searchParams.get('language') ?? 'en';

  // A language code is two to eight letters. Anything else is not one, and this
  // value is going straight into a URL path.
  if (!/^[a-z]{2,8}$/u.test(language)) {
    return NextResponse.json({ error: 'That is not a language code.' }, { status: 400 });
  }

  if (API_KEY === '') {
    return NextResponse.json(
      { error: 'No speech key is configured, so there is nothing to preview.' },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BASE_URL}/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: `${MODEL_PREFIX}/${language}`, input: SAMPLE }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json({ error: 'The speech server did not answer.' }, { status: 504 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `No voice available for “${language}”.` },
      { status: upstream.status === 502 ? 422 : 502 },
    );
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      // Samples never change, so the browser should keep them for the session.
      'cache-control': 'private, max-age=3600',
    },
  });
}
