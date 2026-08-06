import { NextResponse } from 'next/server';

import { editSchedule } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

/** Changes a schedule. Only the fields present in the body are touched. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    language?: unknown;
    intervalMinutes?: unknown;
    enabled?: unknown;
  };

  const changes = {
    ...(typeof body.name === 'string' && body.name.trim() !== '' ? { name: body.name } : {}),
    ...(typeof body.language === 'string' ? { language: body.language } : {}),
    ...(typeof body.intervalMinutes === 'number' ? { intervalMinutes: body.intervalMinutes } : {}),
    ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
  };

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await editSchedule(id, changes));
  } catch (error) {
    return toReply(error);
  }
}
