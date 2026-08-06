import { NextResponse } from 'next/server';

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { deleteRuns, listRuns, startRun } from '@/lib/server/backend';
import { MEDIA_ROOT } from '@/lib/server/paths';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  try {
    return NextResponse.json({ runs: await listRuns() });
  } catch (error) {
    return toReply(error);
  }
}

/**
 * Deletes runs, and the media each one produced.
 *
 * The backend forgets the rows; the files are this app's to remove because it
 * is the only side that knows where the media root is mounted. A directory that
 * is already gone is not an error — the cleanup step may have taken it first.
 */
export async function DELETE(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };

  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'Select at least one run to delete.' }, { status: 400 });
  }

  try {
    const result = await deleteRuns(ids as string[]);
    const removed = new Set(result.skipped);

    await Promise.all(
      (ids as string[])
        .filter((id) => !removed.has(id))
        .map((id) => rm(join(MEDIA_ROOT, 'workflows', id), { recursive: true, force: true })),
    );

    return NextResponse.json(result);
  } catch (error) {
    return toReply(error);
  }
}

/** Starts a run from a topic somebody typed. */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { topic, language } = (await request.json().catch(() => ({}))) as {
    topic?: unknown;
    language?: unknown;
  };

  if (typeof topic !== 'string' || topic.trim().length < 3) {
    return NextResponse.json(
      { error: 'Give the video a topic of at least three characters.' },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await startRun(topic.trim(), typeof language === 'string' ? language : 'en'),
      { status: 202 },
    );
  } catch (error) {
    return toReply(error);
  }
}
