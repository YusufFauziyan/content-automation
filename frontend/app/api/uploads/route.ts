import { NextResponse } from 'next/server';

import { deleteUploads, recordUpload } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

/**
 * Records a publish by hand.
 *
 * The one place the history may be asserted rather than observed: a person can
 * post the video themselves, and the browser can post it and fail to read back
 * the link. Both leave the record less true than the world.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    workflowRunId?: unknown;
    platform?: unknown;
    externalUrl?: unknown;
    status?: unknown;
  };

  if (typeof body.workflowRunId !== 'string' || body.workflowRunId === '') {
    return NextResponse.json({ error: 'Say which run was published.' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await recordUpload({
        workflowRunId: body.workflowRunId,
        platform: typeof body.platform === 'string' ? body.platform : 'TIKTOK',
        ...(typeof body.externalUrl === 'string' ? { externalUrl: body.externalUrl } : {}),
        ...(typeof body.status === 'string' ? { status: body.status } : {}),
      }),
      { status: 201 },
    );
  } catch (error) {
    return toReply(error);
  }
}

/** Forgets the record. The video on the platform is untouched. */
export async function DELETE(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'Select at least one upload.' }, { status: 400 });
  }

  try {
    return NextResponse.json(await deleteUploads(ids as string[]));
  } catch (error) {
    return toReply(error);
  }
}
