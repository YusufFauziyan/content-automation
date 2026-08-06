import { PageHeader } from '@/components/nav-shell';
import { LogsTable } from '@/components/logs-table';
import { recentLogs } from '@/lib/server/backend';
import { requireSession } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

/** Enough to cover an incident without asking the database for everything. */
const WINDOW = 500;

export default async function LogsPage() {
  await requireSession();

  let logs: Awaited<ReturnType<typeof recentLogs>> = [];
  let unreachable: string | null = null;

  try {
    logs = await recentLogs(WINDOW);
  } catch (error) {
    unreachable = error instanceof Error ? error.message : 'The backend is not answering.';
  }

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle={`The last ${WINDOW} records across every run. Newest first.`}
      />

      <div className="px-8 py-6">
        {unreachable ? (
          <p className="rounded-[12px] border border-warn/25 bg-warn/8 px-4 py-3 text-[12.5px] text-dim">
            {unreachable}
          </p>
        ) : (
          <LogsTable logs={logs} />
        )}
      </div>
    </>
  );
}
