import { NextResponse } from 'next/server';

import { settleStep } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

/**
 * Decides a step's outcome by hand.
 *
 * The escape hatch for a step nothing is executing any more — a process that
 * was stopped mid-publish leaves one, and no amount of automated reasoning can
 * tell whether the video went up. Only somebody who looked can.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string; step: string }> },
) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { status } = (await request.json().catch(() => ({}))) as { status?: unknown };

  if (typeof status !== 'string') {
    return NextResponse.json({ error: 'Say what the step should become.' }, { status: 400 });
  }

  const { runId, step } = await params;

  try {
    return NextResponse.json(await settleStep(runId, step, status));
  } catch (error) {
    return toReply(error);
  }
}
