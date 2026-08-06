import { NextResponse } from 'next/server';

import { setCredentialEnabled } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await ctx.params;
  const { enabled } = (await request.json().catch(() => ({}))) as { enabled?: unknown };

  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Send whether it should be on or off.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await setCredentialEnabled(id, enabled));
  } catch (error) {
    return toReply(error);
  }
}
