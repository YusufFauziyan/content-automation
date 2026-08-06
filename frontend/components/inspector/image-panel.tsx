'use client';

import { AlertCircle, Check, ClipboardList, Copy, Images, Loader2, RefreshCw, Upload, UserRound } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/clipboard';
import { useRun } from '@/lib/store';
import type { Run, Scene } from '@/lib/types';
import { cn, formatBytes } from '@/lib/utils';

/**
 * Recovery panel for the image step.
 *
 * When the provider runs out of capacity the run stops with some scenes filled
 * and some empty. The way out is not to wait: every scene already has a written
 * brief, so a person can take that brief elsewhere, make the picture by hand and
 * hand it back. This panel is that path — the prompt is copyable, the drop zone
 * is per scene, and a supplied still is marked as such forever.
 */
export function ImagePanel({ run }: { run: Run }) {
  const { toast, uploadMany, bulk } = useRun();
  const [copiedAll, setCopiedAll] = useState(false);
  const [dropping, setDropping] = useState(false);
  const many = useRef<HTMLInputElement>(null);

  const ready = run.scenes.filter((s) => s.status === 'ok').length;
  const empty = run.scenes.filter((s) => s.status !== 'ok');
  const missing = empty.length;

  /**
   * One block of text for every scene still waiting on an image.
   *
   * Eight failed scenes should not mean eight round trips to the clipboard.
   * Scene numbers are kept in the text so the images come back nameable.
   */
  const copyAll = async () => {
    const text = empty
      .map((scene) => `Scene ${String(scene.scene).padStart(2, '0')}\n${scene.prompt}`)
      .join('\n\n');

    if (await copyText(text)) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    } else {
      toast('error', 'The browser would not let us copy.', 'Select the text and copy it by hand.');
    }
  };

  const emptyScenes = empty.map((scene) => scene.scene);

  /**
   * Files land on the empty scenes in order — first file to the lowest scene
   * number without an image. Sorting by name first makes that predictable:
   * `scene-03.png` before `scene-11.png`, which is what a person who exported a
   * batch expects.
   */
  const takeMany = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    // Ordering is the server's job now — it has to sort the contents of a zip
    // anyway, and one rule is better than two that could disagree.
    void uploadMany(run.id, emptyScenes, [...list]);
  };

  return (
    <div
      className="flex flex-col gap-4"
      onDragOver={(event) => {
        if (missing === 0) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        if (missing === 0) return;
        event.preventDefault();
        setDropping(false);
        takeMany(event.dataTransfer.files);
      }}
    >
      <div
        className={cn(
          'rounded-[12px] border px-3.5 py-3',
          missing > 0 ? 'border-err/25 bg-err/8' : 'border-ok/25 bg-ok/8',
          dropping && 'border-accent bg-accent/10',
        )}
      >
        <div className="flex items-center gap-2">
          {missing > 0 ? (
            <AlertCircle size={14} className="shrink-0 text-err" />
          ) : (
            <Check size={14} className="shrink-0 text-ok" />
          )}
          <p className="text-[12px] font-medium text-ink">
            {missing > 0
              ? `${missing} of ${run.scenes.length} scenes have no image`
              : `All ${run.scenes.length} scenes have an image`}
          </p>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">
          {missing > 0
            ? 'The provider stopped answering partway through. Copy a prompt, make the still wherever you like, and drop it in below. Resuming asks the provider again for anything still empty, and keeps whatever you supplied.'
            : 'Resume the run and rendering continues from this step.'}
        </p>

        {missing > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => void copyAll()}>
              {copiedAll ? <Check size={11} /> : <ClipboardList size={11} />}
              {copiedAll ? `Copied ${missing} prompts` : `Copy all ${missing} prompts`}
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={bulk !== null}
              onClick={() => many.current?.click()}
            >
              {bulk ? <Loader2 size={11} className="animate-spin" /> : <Images size={11} />}
              {bulk ? 'Uploading…' : `Upload ${missing} images or a .zip`}
            </Button>
          </div>
        ) : null}

        {missing > 0 && bulk === null ? (
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
            Or drop files — or a <b className="text-dim">.zip</b> of them — here. They fill scene{' '}
            {emptyScenes.slice(0, 3).join(', ')}
            {emptyScenes.length > 3 ? '…' : ''} in file-name order.
          </p>
        ) : null}

        <input
          ref={many}
          type="file"
          accept="image/*,.zip,application/zip"
          multiple
          className="hidden"
          onChange={(event) => {
            takeMany(event.target.files);
            event.target.value = '';
          }}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        {run.scenes.map((scene) => (
          <SceneRow key={scene.scene} runId={run.id} scene={scene} />
        ))}
      </div>
    </div>
  );
}

function SceneRow({ runId, scene }: { runId: string; scene: Scene }) {
  const { uploadScene, toast } = useRun();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [copied, setCopied] = useState(false);

  const busy = scene.status === 'uploading' || scene.status === 'pending';
  const failed = scene.status === 'failed';
  const manual = scene.source === 'manual';

  const take = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('error', 'That file is not an image.', 'Use JPEG, PNG or WebP.');
      return;
    }
    void uploadScene(runId, scene.scene, file);
  };

  const copyPrompt = async () => {
    if (await copyText(scene.prompt)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      return;
    }

    toast('error', 'The browser would not let us copy.', 'Select the prompt and copy it by hand.');
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[12px] border bg-rise/60 transition-colors',
        over ? 'border-accent bg-accent/8' : failed ? 'border-err/25' : 'border-white/8',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="flex gap-3 p-3">
        {/* Thumbnail, or the empty slot that invites a file */}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            'relative grid aspect-[9/16] w-[54px] shrink-0 place-items-center overflow-hidden rounded-[8px] border',
            scene.imageUrl ? 'border-white/10' : 'border-dashed border-white/15 hover:border-accent',
          )}
          aria-label={scene.imageUrl ? `Replace scene ${scene.scene}` : `Upload scene ${scene.scene}`}
        >
          {scene.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={scene.imageUrl} alt="" className="size-full object-cover" />
          ) : busy ? (
            <RefreshCw size={13} className="animate-spin text-faint" />
          ) : (
            <Upload size={13} className="text-faint" />
          )}
          {manual ? (
            <span className="absolute bottom-0 inset-x-0 grid h-3.5 place-items-center bg-accent/85 text-[8px] font-semibold text-on-accent">
              MANUAL
            </span>
          ) : null}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="num text-[11px] font-medium text-ink">
              Scene {String(scene.scene).padStart(2, '0')}
            </span>
            {scene.status === 'ok' ? (
              manual ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-px text-[9.5px] font-medium text-accent-hi">
                  <UserRound size={9} /> supplied by you
                </span>
              ) : (
                <span className="rounded-full bg-ok/12 px-1.5 py-px text-[9.5px] font-medium text-ok">
                  generated
                </span>
              )
            ) : busy ? (
              <span className="rounded-full bg-white/6 px-1.5 py-px text-[9.5px] text-faint">
                {scene.status === 'uploading' ? 'uploading' : 'retrying'}
              </span>
            ) : (
              <span className="rounded-full bg-err/12 px-1.5 py-px text-[9.5px] font-medium text-err">
                no image
              </span>
            )}
            <span className="num ml-auto text-[10px] text-faint">
              {scene.width ? `${scene.width}×${scene.height} · ${formatBytes(scene.byteSize)}` : `${scene.durationSeconds}s`}
            </span>
          </div>

          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-dim">{scene.caption}</p>

          {/* The prompt is what a person needs in order to make the missing
              still, so it is shown rather than hidden behind a disclosure —
              but capped in height. These run to several sentences, and eight
              of them at full length turns the panel into a wall of text you
              have to scroll past to reach the next scene. The copy button
              always takes the whole thing, so nothing is lost by clipping it
              here; the box scrolls for anyone who wants to read it in place. */}
          <div className="mt-1.5 rounded-[8px] border border-white/8 bg-sunk p-2.5">
            <div className="flex items-start gap-2">
              <p className="mono max-h-[3.4rem] min-w-0 flex-1 select-text overflow-y-auto text-[10.5px] leading-relaxed text-dim">
                {scene.prompt}
              </p>
              <button
                type="button"
                onClick={() => void copyPrompt()}
                title="Copy this prompt"
                aria-label={`Copy the prompt for scene ${String(scene.scene)}`}
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-[6px] border transition-colors',
                  copied
                    ? 'border-ok/30 bg-ok/12 text-ok'
                    : 'border-white/10 bg-rise text-faint hover:bg-lift hover:text-ink',
                )}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </div>
            <span
              aria-live="polite"
              className={cn(
                'mt-1.5 block text-[10px] transition-opacity',
                copied ? 'text-ok opacity-100' : 'opacity-0',
              )}
            >
              Copied to the clipboard
            </span>
          </div>

          {failed && scene.error ? (
            <p className="mono mt-1.5 text-[10px] text-err/85">{scene.error.code}</p>
          ) : null}

          <div className="mt-2">
            {failed ? (
              <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
                <Upload size={11} /> Upload a still
              </Button>
            ) : (
              // Replacing was only ever possible by clicking the thumbnail,
              // which nothing announced. A picture you can swap should say so.
              <Button size="sm" variant="ghost" onClick={() => input.current?.click()}>
                <RefreshCw size={11} /> Replace image
              </Button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          take(event.target.files?.[0]);
          // Cleared so picking the same file again still raises a change event.
          event.target.value = '';
        }}
      />
    </div>
  );
}
