import { NextResponse } from 'next/server';

import { createSchedule, deleteSchedules, listSchedules } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ schedules: await listSchedules() });
  } catch (error) {
    return toReply(error);
  }
}

export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { name, language, intervalMinutes } = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    language?: unknown;
    intervalMinutes?: unknown;
  };

  if (typeof name !== 'string' || name.trim() === '') {
    return NextResponse.json({ error: 'Give the schedule a name.' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await createSchedule({
        name: name.trim(),
        language: typeof language === 'string' ? language : 'en',
        intervalMinutes: typeof intervalMinutes === 'number' ? intervalMinutes : 360,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toReply(error);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one schedule.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await deleteSchedules(ids as string[]));
  } catch (error) {
    return toReply(error);
  }
}
