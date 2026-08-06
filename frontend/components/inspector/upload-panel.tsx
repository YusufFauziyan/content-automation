'use client';

import { Check, Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { VideoPanel } from '@/components/inspector/video-panel';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import type { Run, UploadResult } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Destinations a publish can be recorded against. */
const PLATFORMS = ['TIKTOK', 'YOUTUBE'] as const;

/**
 * Says a run's video was published, whoever published it.
 *
 * The one place the record may be asserted rather than observed. Two things
 * make it necessary: a person can post the video themselves, and the browser
 * can post it and fail to read the link back. Both leave the history less true
 * than the world, and only a person can settle which.
 */
function RecordByHand({ run, existing }: { run: Run; existing: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<string>('TIKTOK');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workflowRunId: run.id, platform, externalUrl: url.trim() }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? 'That could not be recorded.');
      return;
    }

    setOpen(false);
    setUrl('');
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        {existing ? 'Record another platform' : 'I published this myself'}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-[12px] border border-white/8 bg-rise/40 p-3.5">
      <p className="text-[11.5px] leading-relaxed text-dim">
        Marks this run as published. Recorded as verified — you have seen it live, which is what
        verifying is for.
      </p>

      <div className="mt-2.5 flex gap-1.5">
        {PLATFORMS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={platform === option}
            onClick={() => setPlatform(option)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
              platform === option ? 'bg-accent/15 text-accent-hi' : 'bg-white/6 text-faint hover:text-dim',
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <label htmlFor="published-url" className="mt-3 block text-[11px] font-medium text-dim">
        Published URL <span className="text-faint">(optional — add it later if you like)</span>
      </label>
      <input
        id="published-url"
        autoFocus
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://www.tiktok.com/@handle/video/…"
        className="mono mt-1.5 h-9 w-full rounded-[10px] border border-white/10 bg-sunk px-3 text-[11.5px] text-ink outline-none focus:border-accent"
      />

      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-err">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          Record it
        </Button>
      </div>
    </form>
  );
}

const TONE: Record<string, string> = {
  VERIFIED: 'text-ok bg-ok/12',
  UPLOADED: 'text-node-media bg-node-media/12',
  UPLOADING: 'text-node-ai bg-node-ai/12',
  PENDING: 'text-faint bg-white/6',
  FAILED: 'text-err bg-err/12',
};

const when = (value: string | null): string =>
  value === null ? '—' : new Date(value).toLocaleString();

/**
 * Publishes again, to one destination or every connected one.
 *
 * Returned as a hook rather than a component because both the per-destination
 * row and the whole-step panel need the same call with a different argument,
 * and duplicating the request is how the two drift apart.
 */
function usePublish() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function publish(runId: string, platform?: string) {
    setBusy(platform ?? 'ALL');
    setError(null);

    const response = await fetch(`/api/runs/${runId}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(platform === undefined ? {} : { platform }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);

    if (!response.ok) {
      setError(body.error ?? 'That could not be published.');
      return;
    }
    router.refresh();
  }

  return { publish, busy, error };
}

/** One destination's row. */
function Destination({
  run,
  upload,
  publish,
  busy,
}: {
  run: Run;
  upload: UploadResult;
  publish: (runId: string, platform?: string) => Promise<void>;
  busy: string | null;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-[12px] border border-white/8 bg-rise/40 p-3.5">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-ink">{upload.platform}</span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
            TONE[upload.status] ?? 'bg-white/6 text-dim',
          )}
        >
          {upload.status}
        </span>
      </div>

      {upload.externalUrl ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <a
            href={upload.externalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mono inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-[8px] border border-white/8 bg-sunk px-2.5 py-1.5 text-[11px] text-dim hover:border-accent/40 hover:text-accent-hi"
          >
            <span className="truncate">{upload.externalUrl}</span>
            <ExternalLink size={11} className="shrink-0" />
          </a>
          <button
            type="button"
            aria-label={`Copy the ${upload.platform} URL`}
            onClick={() => {
              void copyText(upload.externalUrl ?? '').then(setCopied);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="shrink-0 rounded-[8px] border border-white/8 bg-sunk p-1.5 text-faint hover:text-ink"
          >
            {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">
          No URL recorded. Add it from the Uploads page, or below.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="text-faint">Uploaded</dt>
          <dd className="num mt-0.5 text-dim">{when(upload.uploadedAt)}</dd>
        </div>
        <div>
          <dt className="text-faint">Verified</dt>
          <dd className="num mt-0.5 text-dim">{when(upload.verifiedAt)}</dd>
        </div>
      </dl>

      <Button
        type="button"
        variant="ghost"
        className="mt-2.5 w-full"
        disabled={busy !== null}
        onClick={() => void publish(run.id, upload.platform)}
      >
        {busy === upload.platform ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <RotateCw size={12} />
        )}
        Publish to {upload.platform} again
      </Button>
    </div>
  );
}

/**
 * Deciding a stuck step by hand.
 *
 * Shown only while the step claims to be running or has failed, because that is
 * the only time the question arises: a video can be live while the step that
 * posted it was killed, and nothing automated recovers that — only somebody who
 * looked. Retrying sets the step back to failed and resumes, which is the same
 * path a crashed run takes.
 */
function StepActions({ run }: { run: Run }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const step = run.steps.find((entry) => entry.step === 'UPLOAD');

  if (!step || (step.status !== 'RUNNING' && step.status !== 'FAILED')) return null;

  async function act(what: 'settle' | 'retry', platform?: string) {
    setBusy(platform ?? what);
    setError(null);

    if (what === 'settle') {
      const settled = await fetch(`/api/runs/${run.id}/steps/UPLOAD`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'SUCCEEDED' }),
      });
      setBusy(null);

      if (!settled.ok) {
        setError('That step could not be changed.');
        return;
      }
      router.refresh();

      return;
    }

    // Publishing directly rather than resetting the step and resuming: a resume
    // would walk the whole pipeline again to reach this one stage, and would
    // give no way to name a single destination.
    const response = await fetch(`/api/runs/${run.id}/publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(platform === undefined ? {} : { platform }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);

    if (!response.ok) {
      setError(body.error ?? 'That could not be published.');
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-[12px] border border-warn/25 bg-warn/8 p-3.5">
      <p className="text-[11.5px] leading-relaxed text-dim">
        {step.status === 'RUNNING'
          ? 'This step says it is running. If nothing is actually publishing — the process was stopped, or the video is already up — settle it here.'
          : 'This step failed. If the video did go up, mark it done; otherwise try publishing again.'}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={busy !== null}
          onClick={() => void act('settle')}
        >
          {busy === 'settle' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Mark as done
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={busy !== null}
          onClick={() => void act('retry')}
        >
          {busy === 'retry' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RotateCw size={13} />
          )}
          Publish to all again
        </Button>
      </div>

      {/* One at a time, for when a single destination is the one that failed. */}
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {PLATFORMS.map((platform) => (
          <Button
            key={platform}
            type="button"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void act('retry', platform)}
          >
            {busy === platform ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RotateCw size={11} />
            )}
            {platform} only
          </Button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[11px] text-err">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Where this run's video ended up, per destination.
 *
 * Shown above the player rather than instead of it: the render is deleted once
 * an upload is verified, so on an old run the links are all there is, while on
 * a fresh one both are worth having.
 */
export function UploadPanel({ run }: { run: Run }) {
  const { publish, busy, error } = usePublish();

  return (
    <div className="flex flex-col gap-4">
      <StepActions run={run} />

      {error ? (
        <p role="alert" className="rounded-[12px] border border-err/25 bg-err/8 px-3.5 py-2.5 text-[12px] text-err">
          {error}
        </p>
      ) : null}

      {run.uploads.length === 0 ? (
        <p className="rounded-[12px] border border-white/8 bg-rise/40 px-3.5 py-3 text-[12px] leading-relaxed text-dim">
          This run has not published anywhere. The step is skipped when no account is enabled in{' '}
          <span className="text-ink">Credentials</span> — a run with nowhere to publish is still a
          finished run.
        </p>
      ) : (
        run.uploads.map((upload) => (
          <Destination
            key={upload.platform}
            run={run}
            upload={upload}
            publish={publish}
            busy={busy}
          />
        ))
      )}

      <RecordByHand run={run} existing={run.uploads.length > 0} />
      <VideoPanel run={run} />
    </div>
  );
}
