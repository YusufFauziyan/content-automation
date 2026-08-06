import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/nav-shell';
import { listRuns } from '@/lib/server/backend';
import { requireSession } from '@/lib/server/guard';
import type { RunStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TONE: Record<RunStatus, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  SUCCEEDED: { label: 'Completed', className: 'text-ok bg-ok/12', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', className: 'text-err bg-err/12', Icon: AlertTriangle },
  RUNNING: { label: 'Running', className: 'text-accent-hi bg-accent/15', Icon: Loader2 },
  PENDING: { label: 'Pending', className: 'text-faint bg-white/6', Icon: Clock },
};

export default async function DashboardPage() {
  await requireSession();

  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  let unreachable: string | null = null;

  try {
    runs = await listRuns(200);
  } catch (error) {
    unreachable = error instanceof Error ? error.message : 'The backend is not answering.';
  }

  const counts = {
    total: runs.length,
    failed: runs.filter((run) => run.status === 'FAILED').length,
    running: runs.filter((run) => run.status === 'RUNNING').length,
    done: runs.filter((run) => run.status === 'SUCCEEDED').length,
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="What the pipeline has been doing." />

      <div className="px-8 py-6">
        {unreachable ? (
          <p className="rounded-[12px] border border-warn/25 bg-warn/8 px-4 py-3 text-[12.5px] text-dim">
            {unreachable}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Runs" value={counts.total} />
              <Stat label="Completed" value={counts.done} tone="text-ok" />
              <Stat label="Needs attention" value={counts.failed} tone="text-err" />
              <Stat label="In flight" value={counts.running} tone="text-accent-hi" />
            </div>

            <h2 className="mb-3 mt-9 text-[10px] font-semibold uppercase tracking-[0.11em] text-faint">
              Recent runs
            </h2>

            {runs.length === 0 ? (
              <p className="rounded-[12px] border border-white/8 bg-rise/40 px-4 py-6 text-center text-[12.5px] text-faint">
                No runs yet. Start one from the backend with{' '}
                <code className="mono text-dim">pnpm tsx src/main.ts generate</code>.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {runs.slice(0, 8).map((run) => {
                  const tone = TONE[run.status];
                  return (
                    <li key={run.id}>
                      <Link
                        href={`/workflows/${run.id}`}
                        className="flex items-center gap-3 rounded-[12px] border border-white/8 bg-rise/40 px-4 py-3 transition-colors hover:border-white/14 hover:bg-rise"
                      >
                        <tone.Icon size={15} className={tone.className.split(' ')[0]} />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{run.title}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${tone.className}`}
                        >
                          {tone.label}
                        </span>
                        <span className="mono hidden shrink-0 text-[10.5px] text-faint sm:block">
                          {run.id.slice(0, 8)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-[16px] border border-white/8 bg-rise/40 px-5 py-4">
      <p className="text-[11px] text-faint">{label}</p>
      <p className={`num mt-1 text-[26px] font-semibold tracking-[-0.02em] ${tone ?? ''}`}>{value}</p>
    </div>
  );
}
