import { NextResponse } from 'next/server';

import { suggestTopics } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { language, count } = (await request.json().catch(() => ({}))) as {
    language?: unknown;
    count?: unknown;
  };

  try {
    return NextResponse.json(
      await suggestTopics(
        typeof language === 'string' ? language : 'en',
        typeof count === 'number' ? count : 5,
      ),
    );
  } catch (error) {
    return toReply(error);
  }
}
