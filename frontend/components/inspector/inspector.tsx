'use client';

import { MousePointerClick, PanelRightClose } from 'lucide-react';
import { useState } from 'react';

import { ImagePanel } from '@/components/inspector/image-panel';
import { ScenePanel } from '@/components/inspector/scene-panel';
import { AudioPanel, SubtitlePanel } from '@/components/inspector/track-panels';
import { UploadPanel } from '@/components/inspector/upload-panel';
import { VideoPanel } from '@/components/inspector/video-panel';
import { Badge, STATUS_LABEL, STATUS_TONE } from '@/components/ui/badge';
import { ResizeHandle } from '@/components/ui/resize-handle';
import { useResizable } from '@/lib/use-resizable';
import { useRun } from '@/lib/store';
import { CATEGORY_COLOR, STEP_META, type Run, type StepName } from '@/lib/types';
import { cn, formatClock, formatDuration } from '@/lib/utils';

type Tab = 'params' | 'advanced' | 'logs' | 'output';

/**
 * Width bounds for the panel.
 *
 * The floor is where the parameter labels and their values stop fitting on one
 * line; the ceiling leaves the canvas wider than a single node column, so the
 * graph never becomes unreadable to make room for a form.
 */
const MIN_WIDTH = 288;
const MAX_WIDTH = 620;
const DEFAULT_WIDTH = 330;

const TABS: { id: Tab; label: string }[] = [
  { id: 'params', label: 'Parameters' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'logs', label: 'Logs' },
  { id: 'output', label: 'Output' },
];

/** Per-step parameter sheets. Adding a step means adding an entry, nothing else. */
const PARAMS: Partial<Record<StepName, { label: string; value: string; env?: boolean; help?: string }[]>> = {
  IMAGE: [
    { label: 'Provider', value: '9 Router' },
    { label: 'Image Combo', value: 'NINE_ROUTER_IMAGE_COMBO', env: true, help: 'Resolves to ag/gemini-3.1-flash-image-9x16' },
    { label: 'Prompt Source', value: 'Scene Prompt' },
    { label: 'Output Folder', value: 'images/' },
    { label: 'Concurrency', value: '1', help: 'Scenes share one router quota — a burst turns a rate limit into a failed step.' },
    { label: 'Retry', value: '3' },
    { label: 'Timeout', value: '180000', help: 'Milliseconds.' },
  ],
  UPLOAD: [
    { label: 'Platform', value: 'TikTok' },
    { label: 'Signs in as', value: 'The enabled account in Credentials', help: 'Skipped, not failed, when no account is enabled — a run without a place to publish is still a finished run.' },
    { label: 'Upload page', value: 'TIKTOK_UPLOAD_URL', env: true },
    { label: 'Browser', value: 'TIKTOK_HEADLESS', env: true, help: 'Headless is challenged far more often than a visible browser.' },
    { label: 'Timeout', value: 'TIKTOK_TIMEOUT', env: true, help: 'Milliseconds, per stage.' },
    { label: 'Audience', value: 'Everyone', help: 'Set explicitly before posting — TikTok remembers the last choice and starts new accounts private.' },
    { label: 'Verified before cleanup', value: 'Yes', help: 'Cleanup deletes the only copy of the video, so an unverifiable upload fails rather than being assumed.' },
  ],
  VOICE: [
    { label: 'Provider', value: '9 Router' },
    { label: 'Voice', value: 'ROUTER_SPEECH_LANGUAGE', env: true, help: 'One voice per language — the language is the voice.' },
    { label: 'Speed', value: '1.0' },
    { label: 'Timing', value: 'Measured per block', help: 'Each block is spoken separately and probed, so captions cannot drift.' },
  ],
  SCENE: [
    { label: 'Planner', value: 'SceneAgent' },
    { label: 'Target length', value: 'From the script' },
    { label: 'Per scene', value: 'Narration, image brief, camera, transition' },
  ],
  VISUAL_PLAN: [
    { label: 'Planner', value: 'VisualPlannerAgent' },
    { label: 'One brief per scene', value: 'Yes' },
    { label: 'Aspect ratio', value: '9:16' },
  ],
  SUBTITLE: [
    { label: 'Source', value: 'Measured narration plan' },
    { label: 'Max lines per cue', value: '2' },
    { label: 'Max characters per line', value: '42' },
    { label: 'Burned in', value: 'Yes, bottom centre' },
    { label: 'Height above bottom', value: 'VIDEO_SUBTITLE_BOTTOM_FRACTION', env: true, help: 'A fraction of frame height. TikTok draws its own caption and handle over the bottom ~15%, so text placed lower lands underneath them.' },
  ],
  COMPOSE: [
    { label: 'Resolution', value: '1080×1920' },
    { label: 'Frame rate', value: '30' },
    { label: 'Video codec', value: 'libx264 · crf 23' },
    { label: 'Audio codec', value: 'aac' },
    { label: 'Subtitles', value: 'Burned in, bottom centre' },
  ],
};

export function Inspector({
  run,
  selected,
}: {
  run: Run;
  selected: StepName | null;
}) {
  const [tab, setTab] = useState<Tab>('params');
  const { setInspectorOpen } = useRun();
  const panel = useResizable({
    initial: DEFAULT_WIDTH,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    storageKey: 'yu:inspector-width',
    edge: 'left',
  });

  const handle = (
    <ResizeHandle
      edge="left"
      value={panel.size}
      min={MIN_WIDTH}
      max={MAX_WIDTH}
      dragging={panel.dragging}
      label="Resize the inspector"
      onPointerDown={panel.onPointerDown}
      onKeyDown={panel.onKeyDown}
      onReset={panel.reset}
    />
  );

  if (!selected) {
    return (
      <aside
        style={{ width: panel.size }}
        className="relative flex shrink-0 flex-col border-l border-white/6 bg-base"
      >
        {handle}
        <div className="flex justify-end px-3 pt-3">
          <button
            onClick={() => setInspectorOpen(false)}
            aria-label="Close the inspector"
            title="Close the inspector"
            className="grid size-6 shrink-0 place-items-center rounded-[7px] text-faint transition-colors hover:bg-rise hover:text-ink"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
        <div className="flex flex-col items-center gap-2.5 px-6 py-11 text-center">
          <MousePointerClick size={26} className="text-faint" strokeWidth={1.5} />
          <p className="text-[12px] text-faint">Select a step on the canvas to inspect it.</p>
        </div>
      </aside>
    );
  }

  const meta = STEP_META[selected];
  const step = run.steps.find((s) => s.step === selected);
  const color = CATEGORY_COLOR[meta.category];
  const logs = run.logs.filter((l) => l.source.toLowerCase().includes(meta.title.split(' ')[0]!.toLowerCase()));

  return (
    <aside
      style={{ width: panel.size }}
      className="relative flex shrink-0 flex-col border-l border-white/6 bg-base"
    >
      {handle}
      <div className="shrink-0 px-4 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-[30px] shrink-0 place-items-center rounded-[9px]"
            style={{
              background: `color-mix(in srgb, ${color} 16%, transparent)`,
              color,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 26%, transparent)`,
            }}
          >
            <span className="size-2 rounded-full bg-current" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{meta.title}</p>
            <p className="truncate text-[10.5px] text-faint">{meta.subtitle}</p>
          </div>
          {step ? (
            <Badge tone={STATUS_TONE[step.status]} pulse={step.status === 'RUNNING'}>
              {STATUS_LABEL[step.status]}
            </Badge>
          ) : null}
          <button
            onClick={() => setInspectorOpen(false)}
            aria-label="Close the inspector"
            title="Close the inspector"
            className="grid size-6 shrink-0 place-items-center rounded-[7px] text-faint transition-colors hover:bg-rise hover:text-ink"
          >
            <PanelRightClose size={14} />
          </button>
        </div>

        <div className="mt-3.5 flex gap-0.5 border-b border-white/6" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'relative px-2.5 py-2 text-[12px] font-medium transition-colors',
                tab === t.id ? 'text-ink' : 'text-faint hover:text-dim',
              )}
            >
              {t.label}
              {tab === t.id ? (
                <span className="absolute inset-x-2 -bottom-px h-[1.5px] rounded-full bg-accent" />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'params' ? (
          selected === 'IMAGE' ? (
            <ImagePanel run={run} />
          ) : (
            <>
              <Fields step={selected} />
              {/* The artefact belongs next to the settings that produced it —
                  hiding a playable track one tab away is a click nobody has a
                  reason to make. */}
              {(selected === 'SCENE' || selected === 'VISUAL_PLAN') && run.scenes.length > 0 ? (
                <div className="mt-4 border-t border-white/6 pt-4">
                  <ScenePanel run={run} />
                </div>
              ) : null}
              {selected === 'VOICE' && run.audio ? (
                <div className="mt-4 border-t border-white/6 pt-4">
                  <AudioPanel run={run} />
                </div>
              ) : null}
              {selected === 'SUBTITLE' && run.subtitle ? (
                <div className="mt-4 border-t border-white/6 pt-4">
                  <SubtitlePanel run={run} />
                </div>
              ) : null}
            </>
          )
        ) : null}

        {tab === 'advanced' ? (
          <div className="flex flex-col gap-3.5">
            <Row label="Continue on fail" value="off" />
            <Row label="Retry" value="3" />
            <Row label="Backoff" value="1000, 3000, 10000 ms" />
            <Row label="Attempts made" value={String(step?.attempt ?? 0)} />
            <Row label="Last duration" value={formatDuration(step?.durationMs)} />
          </div>
        ) : null}

        {tab === 'logs' ? (
          logs.length === 0 ? (
            <p className="py-10 text-center text-[12px] text-faint">
              No log records for this step yet.
            </p>
          ) : (
            <div className="mono flex flex-col gap-1 text-[11px]">
              {logs.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <span className="shrink-0 text-faint">{formatClock(l.at)}</span>
                  <span
                    className={cn(
                      'shrink-0 font-semibold',
                      l.level === 'ERROR' ? 'text-err' : l.level === 'WARN' ? 'text-warn' : 'text-node-media',
                    )}
                  >
                    {l.level}
                  </span>
                  <span className="text-dim">{l.message}</span>
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === 'output' ? (
          selected === 'UPLOAD' ? (
            <UploadPanel run={run} />
          ) : selected === 'COMPOSE' ? (
            <VideoPanel run={run} />
          ) : selected === 'SCENE' || selected === 'VISUAL_PLAN' ? (
            <ScenePanel run={run} />
          ) : selected === 'VOICE' ? (
            <AudioPanel run={run} />
          ) : selected === 'SUBTITLE' ? (
            <SubtitlePanel run={run} />
          ) : step?.status === 'SUCCEEDED' ? (
            <pre className="mono overflow-x-auto rounded-[10px] border border-white/8 bg-sunk p-3 text-[11px] leading-relaxed text-dim">
              {JSON.stringify({ step: selected, status: 'ok', durationMs: step.durationMs }, null, 2)}
            </pre>
          ) : (
            <p className="py-10 text-center text-[12px] text-faint">
              Output appears once this step succeeds.
            </p>
          )
        ) : null}
      </div>
    </aside>
  );
}

function Fields({ step }: { step: StepName }) {
  const fields = PARAMS[step];

  if (!fields) {
    return (
      <p className="py-10 text-center text-[12px] text-faint">
        This step takes no parameters of its own.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {fields.map((f) => (
        <div key={f.label} className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-dim">
            {f.label}
            {f.env ? (
              <span className="rounded-[5px] border border-ok/20 bg-ok/10 px-1.5 py-px text-[9.5px] text-ok">
                env
              </span>
            ) : null}
          </label>
          <input
            readOnly={f.env}
            defaultValue={f.value}
            className={cn(
              'h-8 w-full rounded-[10px] border border-white/10 bg-rise px-2.5 text-[12.5px] text-ink outline-none',
              'transition-colors focus:border-accent',
              f.env && 'mono text-dim',
            )}
          />
          {f.help ? <p className="text-[10.5px] leading-relaxed text-faint">{f.help}</p> : null}
        </div>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11.5px] text-dim">{label}</span>
      <span className="num text-[11.5px] text-ink">{value}</span>
    </div>
  );
}
