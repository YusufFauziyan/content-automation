import { PageHeader } from '@/components/nav-shell';
import { UploadsTable } from '@/components/uploads-table';
import { recentUploads } from '@/lib/server/backend';
import { requireSession } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

/** Enough to cover months of publishing without asking for the whole table. */
const WINDOW = 200;

export default async function UploadsPage() {
  await requireSession();

  let uploads: Awaited<ReturnType<typeof recentUploads>> = [];
  let unreachable: string | null = null;

  try {
    uploads = await recentUploads(WINDOW);
  } catch (error) {
    unreachable = error instanceof Error ? error.message : 'The backend is not answering.';
  }

  return (
    <>
      <PageHeader
        title="Uploads"
        subtitle="Every video that was published, and every attempt that was not."
      />

      <div className="px-8 py-6">
        {unreachable ? (
          <p className="rounded-[12px] border border-warn/25 bg-warn/8 px-4 py-3 text-[12.5px] text-dim">
            {unreachable}
          </p>
        ) : (
          <UploadsTable uploads={uploads} />
        )}
      </div>
    </>
  );
}
