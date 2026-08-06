import { NextResponse } from 'next/server';

import { readCapture } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  try {
    return NextResponse.json(await readCapture((await params).id));
  } catch (error) {
    return toReply(error);
  }
}
