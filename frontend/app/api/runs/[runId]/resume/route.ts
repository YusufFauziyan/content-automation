import { NextResponse } from 'next/server';

import { getRun, resumeRun } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import { toReply } from '@/lib/server/reply';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { runId } = await ctx.params;

  try {
    // Refuse before asking the pipeline: a run resumed with a scene still empty
    // renders a video with a hole in it, and that is only discovered afterwards.
    const run = await getRun(runId);
    const missing = run.scenes.filter((s) => s.status !== 'ok').map((s) => s.scene);

    if (run.failedStep === 'IMAGE' && missing.length > 0) {
      return NextResponse.json(
        {
          error: `Scene ${missing.join(', ')} still has no image.`,
          hint: 'Generate them again or upload a still for each, then resume.',
          missing,
        },
        { status: 422 },
      );
    }

    return NextResponse.json(await resumeRun(runId));
  } catch (error) {
    return toReply(error);
  }
}
