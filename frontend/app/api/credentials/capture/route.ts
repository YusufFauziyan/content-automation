import { NextResponse } from 'next/server';

import { startCapture, type CredentialPlatform } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

/**
 * Opens a browser on the backend machine and starts waiting for a sign-in.
 *
 * Answers immediately with something to poll rather than holding the request
 * open: signing in means captcha and a phone, and no proxy in between will keep
 * a connection alive that long.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { platform, label } = (await request.json().catch(() => ({}))) as {
    platform?: unknown;
    label?: unknown;
  };

  if (typeof label !== 'string' || label.trim() === '') {
    return NextResponse.json({ error: 'Give the account a handle.' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await startCapture({ platform: platform as CredentialPlatform, label: label.trim() }),
      { status: 202 },
    );
  } catch (error) {
    return toReply(error);
  }
}
