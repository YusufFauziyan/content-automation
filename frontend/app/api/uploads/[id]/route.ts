import { NextResponse } from 'next/server';

import { editUpload } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    externalUrl?: unknown;
    status?: unknown;
  };

  if (typeof body.externalUrl !== 'string' && typeof body.status !== 'string') {
    return NextResponse.json({ error: 'Send a URL, a status, or both.' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await editUpload((await params).id, {
        ...(typeof body.externalUrl === 'string' ? { externalUrl: body.externalUrl } : {}),
        ...(typeof body.status === 'string' ? { status: body.status } : {}),
      }),
    );
  } catch (error) {
    return toReply(error);
  }
}
