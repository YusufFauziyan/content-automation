import { PageHeader } from '@/components/nav-shell';
import { CredentialsPanel } from '@/components/credentials-panel';
import { listCredentials } from '@/lib/server/backend';
import { requireSession } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

export default async function CredentialsPage() {
  await requireSession();

  let credentials: Awaited<ReturnType<typeof listCredentials>> = [];
  let unreachable: string | null = null;

  try {
    credentials = await listCredentials();
  } catch (error) {
    unreachable = error instanceof Error ? error.message : 'The backend is not answering.';
  }

  return (
    <>
      <PageHeader
        title="Credentials"
        subtitle="Accounts a finished video can be published to."
      />

      <div className="px-8 py-6">
        {unreachable ? (
          <p className="rounded-[12px] border border-warn/25 bg-warn/8 px-4 py-3 text-[12.5px] text-dim">
            {unreachable}
          </p>
        ) : (
          <CredentialsPanel credentials={credentials} />
        )}
      </div>
    </>
  );
}
