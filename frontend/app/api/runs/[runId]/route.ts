import { NextResponse } from 'next/server';

import { getRun } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { runId } = await ctx.params;

  try {
    return NextResponse.json(await getRun(runId));
  } catch (error) {
    return toReply(error);
  }
}
