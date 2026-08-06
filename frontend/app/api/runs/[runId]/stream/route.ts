import { getRun } from '@/lib/server/backend';
import { requireApiSession } from '@/lib/server/guard';
import type { Run } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** How often the server looks for a change. The browser is told nothing until there is one. */
const TICK_MS = 2_000;

/** A run that has settled stops being watched; nothing more is going to happen. */
const IDLE_TICKS_BEFORE_CLOSE = 15;

/**
 * Live updates for one run, over Server-Sent Events.
 *
 * The browser used to ask for the whole run several times a second, which meant
 * a database round trip and a directory walk each time whether or not anything
 * had moved. Now one connection stays open and the server sends a message only
 * when the state actually differs from what it last sent.
 *
 * The polling did not disappear so much as move: the tick below still asks the
 * backend. But it happens once per run rather than once per open tab, at a
 * quarter of the rate, and it costs nothing on the wire when nothing changes.
 * A real push would need the backend to publish events, which it does not yet.
 */
export async function GET(request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { runId } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSent = '';
      let idle = 0;
      let closed = false;

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting; nothing to do.
        }
      };

      // The client hangs up by navigating away or closing the tab.
      request.signal.addEventListener('abort', finish);

      const tick = async () => {
        if (closed) return;

        let run: Run;
        try {
          run = await getRun(runId);
        } catch (error) {
          send('error', { message: error instanceof Error ? error.message : 'Lost the run.' });
          finish();
          return;
        }

        const fingerprint = JSON.stringify(run);

        if (fingerprint !== lastSent) {
          lastSent = fingerprint;
          idle = 0;
          send('run', run);
        } else {
          idle += 1;
        }

        // Nothing is executing and nothing has changed for a while: let the
        // connection go rather than tick against an idle run forever.
        const busy = run.status === 'RUNNING';
        if (!busy && idle >= IDLE_TICKS_BEFORE_CLOSE) {
          send('settled', { status: run.status });
          finish();
        }
      };

      const timer = setInterval(() => void tick(), TICK_MS);
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // Nginx and friends buffer streamed responses unless told not to.
      'x-accel-buffering': 'no',
    },
  });
}
