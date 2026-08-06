'use client';

import { History, ImageOff, Loader2, Play, RotateCcw, Save, Search, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRun } from '@/lib/store';
import type { Run } from '@/lib/types';

const RUN_TONE = {
  PENDING: 'idle',
  RUNNING: 'running',
  SUCCEEDED: 'ok',
  FAILED: 'error',
} as const;

const RUN_LABEL = {
  PENDING: 'Draft',
  RUNNING: 'Running',
  SUCCEEDED: 'Completed',
  FAILED: 'Failed',
} as const;

export function TopBar({ run }: { run: Run }) {
  const { resume, resuming } = useRun();

  // Whether work is happening comes from the run itself, not from local state:
  // a page refresh throws away everything the browser knew, and the one thing
  // a person needs to see after refreshing is that the pipeline is still going.
  const executing = run.steps.find((step) => step.status === 'RUNNING') ?? null;
  const running = run.status === 'RUNNING';

  // A run marked running with no step actually executing is one that died
  // between steps. Without this it would claim to be working forever and could
  // never be resumed from here.
  const stalled = running && executing === null;
  const busy = (running && !stalled) || resuming;

  // Resumability comes from the steps, not from the run's status label. A run
  // that stopped after SUBTITLE without any step *failing* still carries a
  // checkpoint status like `SUBTITLE_CREATED`, and reading that as "nothing to
  // do" hid the Resume button on exactly the runs that needed it.
  const unfinished = run.steps.filter((step) => step.status !== 'SUCCEEDED');
  const nextStep = unfinished[0]?.step ?? null;
  const resumable = !busy && nextStep !== null;

  // Resuming with a scene still empty renders a video with a hole in it, and
  // that is only discovered after the render. Better to refuse up front and say
  // which scenes are missing than to let the click fail.
  const missingScenes = run.scenes.filter((scene) => scene.status !== 'ok').map((s) => s.scene);
  const blocked = missingScenes.length > 0;

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/6 bg-base/70 px-3.5 backdrop-blur-xl">
      <input
        defaultValue={run.title}
        aria-label="Workflow name"
        spellCheck={false}
        className="min-w-0 max-w-[320px] flex-1 rounded-[10px] border border-transparent bg-transparent px-2.5 py-1.5 text-[13.5px] font-medium text-ink outline-none transition-colors hover:bg-rise focus:border-accent focus:bg-rise"
      />

      <Badge tone={RUN_TONE[run.status]} pulse={running}>
        {RUN_LABEL[run.status]}
      </Badge>

      {busy && executing ? (
        <span className="mono text-[11px] text-accent-hi">running {executing.step}</span>
      ) : run.failedStep ? (
        <span className="mono text-[11px] text-err/85">stopped at {run.failedStep}</span>
      ) : null}

      {stalled ? (
        <span className="mono text-[11px] text-warn">
          marked running, but no step is executing
        </span>
      ) : null}

      {blocked ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-err/12 px-2 py-0.5 text-[10.5px] font-medium text-err">
          <ImageOff size={11} />
          {missingScenes.length} scene{missingScenes.length === 1 ? '' : 's'} without an image
        </span>
      ) : null}

      <div className="flex-1" />

      <label className="flex h-8 w-[180px] items-center gap-2 rounded-[10px] border border-white/8 bg-rise px-2.5 text-faint focus-within:border-accent">
        <Search size={13} />
        <input
          placeholder="Search steps"
          aria-label="Search steps"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
        />
      </label>

      <Button variant="ghost">
        <History size={14} />
        <span className="hidden sm:inline">History</span>
      </Button>
      <Button>
        <Save size={14} />
        <span className="hidden sm:inline">Save</span>
      </Button>

      {resumable ? (
        <Button
          variant="primary"
          disabled={blocked || resuming}
          aria-busy={resuming}
          onClick={() => void resume(run.id)}
          title={
            blocked
              ? `Scene ${missingScenes.join(', ')} still needs an image. Upload one for each, or generate them again.`
              : resuming
                ? 'The run is being picked up'
                : `Continue from ${String(nextStep)}`
          }
        >
          {resuming ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RotateCcw size={13} />
          )}
          {resuming ? 'Resuming…' : `Resume from ${String(nextStep)}`}
        </Button>
      ) : busy ? (
        <Button variant="primary" disabled aria-busy="true" title="The pipeline is working">
          <Loader2 size={13} className="animate-spin" />
          {executing ? `Running ${executing.step}…` : 'Resuming…'}
        </Button>
      ) : (
        <Button variant="primary" disabled>
          <Play size={13} fill="currentColor" />
          Run
        </Button>
      )}

      <Button>
        <Upload size={14} />
        <span className="hidden lg:inline">Publish</span>
      </Button>

      <div className="grid size-[30px] shrink-0 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-accent to-node-media text-[11px] font-semibold text-on-accent">
        YF
      </div>
    </header>
  );
}
