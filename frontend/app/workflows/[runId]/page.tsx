import { Editor } from '@/components/editor';
import { requireSession } from '@/lib/server/guard';

export const dynamic = 'force-dynamic';

export default async function WorkflowPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireSession();
  const { runId } = await params;

  // The editor owns the whole viewport, so it sits outside the (app) shell.
  return <Editor runId={runId} />;
}
