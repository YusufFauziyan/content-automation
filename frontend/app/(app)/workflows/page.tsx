import { NewWorkflow } from '@/components/new-workflow';
import { PageHeader } from '@/components/nav-shell';
import { RunsTable } from '@/components/runs-table';
import { listRuns } from '@/lib/server/backend';
import { requireSession } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const { q } = await searchParams;

  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  let unreachable: string | null = null;

  try {
    runs = await listRuns();
  } catch (error) {
    unreachable = error instanceof Error ? error.message : 'The backend is not answering.';
  }

  // Failures first: they are the ones asking for a decision.
  const ordered = [...runs].sort(
    (a, b) => Number(b.status === 'FAILED') - Number(a.status === 'FAILED'),
  );

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle={`${runs.length} run${runs.length === 1 ? '' : 's'} — open one to inspect its canvas.`}
        action={<NewWorkflow />}
      />

      <div className="px-8 py-6">
        {unreachable ? (
          <p className="rounded-[12px] border border-warn/25 bg-warn/8 px-4 py-3 text-[12.5px] text-dim">
            {unreachable}
          </p>
        ) : ordered.length === 0 ? (
          <p className="rounded-[12px] border border-white/8 bg-rise/40 px-4 py-6 text-center text-[12.5px] text-faint">
            No runs yet.
          </p>
        ) : (
          <RunsTable runs={ordered} initialQuery={q ?? ''} />
        )}
      </div>
    </>
  );
}
