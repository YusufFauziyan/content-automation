import { NextResponse } from 'next/server';

import { BackendError, BackendUnavailableError } from './backend';

/**
 * Turns a backend failure into a reply the editor can act on.
 *
 * A backend that is not running is a 503 with instructions, not a generic 500 —
 * it is the most common thing to go wrong in development and the message should
 * say what to do about it.
 */
export function toReply(error: unknown): NextResponse {
  if (error instanceof BackendUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  if (error instanceof BackendError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
}
