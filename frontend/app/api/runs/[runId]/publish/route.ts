import { NextResponse } from 'next/server';

import { publishRun } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

/**
 * Publishes an existing video again.
 *
 * With a platform, only that one; without, every connected destination. Nothing
 * is re-rendered either way — the video already exists.
 */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { platform } = (await request.json().catch(() => ({}))) as { platform?: unknown };

  try {
    return NextResponse.json(
      await publishRun(
        (await params).runId,
        typeof platform === 'string' ? platform : undefined,
      ),
    );
  } catch (error) {
    return toReply(error);
  }
}
