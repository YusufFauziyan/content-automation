import { PageHeader } from '@/components/nav-shell';
import { SchedulesTable } from '@/components/schedules-table';
import { listSchedules } from '@/lib/server/backend';
import { requireSession } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  await requireSession();

  let schedules: Awaited<ReturnType<typeof listSchedules>> = [];
  let unreachable: string | null = null;

  try {
    schedules = await listSchedules();
  } catch (error) {
    unreachable = error instanceof Error ? error.message : 'The backend is not answering.';
  }

  const active = schedules.filter((entry) => entry.enabled).length;

  return (
    <>
      <PageHeader
        title="Schedules"
        subtitle={
          schedules.length === 0
            ? 'Nothing scheduled yet.'
            : `${active} of ${schedules.length} active — each firing makes one video.`
        }
      />

      <div className="px-8 py-6">
        {unreachable ? (
          <p className="rounded-[12px] border border-warn/25 bg-warn/8 px-4 py-3 text-[12.5px] text-dim">
            {unreachable}
          </p>
        ) : (
          <SchedulesTable schedules={schedules} />
        )}
      </div>
    </>
  );
}
