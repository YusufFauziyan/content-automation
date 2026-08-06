'use client';

import { Loader2, Play, Plus, RefreshCw, Sparkles, Volume2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Languages the narration can be spoken in.
 *
 * Each was confirmed against the speech endpoint rather than taken from a
 * documentation page — an unsupported code answers 502, and a language offered
 * here that cannot be spoken would produce a video with silence where the
 * narration should be.
 *
 * There is one voice per language, so this list is the whole choice: the
 * endpoint accepts a `voice` field and ignores it.
 */
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
] as const;

const MIN_TOPIC = 3;
const MAX_TOPIC = 200;

/**
 * Starts a run from a topic somebody typed.
 *
 * The pipeline normally invents its own subject; this is the way in for when a
 * person already knows what the video should be about. The topic still goes
 * through duplicate detection — naming it yourself does not exempt it from the
 * rule that no two videos cover the same ground.
 */
export function NewWorkflow() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState<string>('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<{ title: string; hook: string }[]>([]);
  const [thinking, setThinking] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);

  /**
   * Plays a spoken sample of a language.
   *
   * Reading a language name tells you nothing about how the narration will
   * sound, and the voice is not something you can change afterwards without
   * re-rendering the video.
   */
  async function preview(code: string) {
    player.current?.pause();
    setPreviewing(code);
    setError(null);

    try {
      const response = await fetch(`/api/speech/preview?language=${code}`);

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'That sample could not be played.');
        return;
      }

      const audio = new Audio(URL.createObjectURL(await response.blob()));
      player.current = audio;
      audio.onended = () => setPreviewing(null);
      await audio.play();
    } catch {
      setError('That sample could not be played.');
    } finally {
      setPreviewing((current) => (current === code ? null : current));
    }
  }

  const tooShort = topic.trim().length < MIN_TOPIC;

  /**
   * Asks for subjects to choose between.
   *
   * Nothing is written by this: the ideas exist only in the dialog until one is
   * picked and started, so rejecting four of five leaves no trace in the topic
   * library. They come back in the language selected above, because a Spanish
   * video wants a Spanish subject.
   */
  async function suggest() {
    setThinking(true);
    setError(null);

    const response = await fetch('/api/topics/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language, count: 5 }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      ideas?: { title: string; hook: string }[];
      error?: string;
    };

    setThinking(false);

    if (!response.ok || !body.ideas) {
      setError(body.error ?? 'No ideas came back. Try again in a moment.');
      return;
    }

    setIdeas(body.ideas);
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: topic.trim(), language }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? 'The run could not be started.');
      return;
    }

    setOpen(false);
    setTopic('');
    // The run appears in the table once the pipeline has written its first row.
    setTimeout(() => router.refresh(), 1200);
  }

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={14} /> New workflow
      </Button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-workflow-title"
      className="fixed inset-0 z-50 grid place-items-center bg-void/70 p-6 backdrop-blur-sm"
      onClick={() => !busy && setOpen(false)}
    >
      <form
        onSubmit={start}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[460px] rounded-[16px] border border-white/10 bg-base p-5 shadow-[0_24px_60px_-20px_var(--shadow-modal)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 id="new-workflow-title" className="text-[14.5px] font-semibold tracking-[-0.01em]">
              New workflow
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              Name the subject and the pipeline writes, illustrates, narrates and renders it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <label htmlFor="topic" className="text-[11px] font-medium text-dim">
            Topic
          </label>
          <button
            type="button"
            onClick={() => void suggest()}
            disabled={thinking}
            className="flex items-center gap-1.5 text-[11.5px] text-accent-hi transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {thinking ? (
              <Loader2 size={12} className="animate-spin" />
            ) : ideas.length > 0 ? (
              <RefreshCw size={11} />
            ) : (
              <Sparkles size={12} />
            )}
            {thinking ? 'Thinking' : ideas.length > 0 ? 'Other ideas' : 'Suggest topics'}
          </button>
        </div>
        <textarea
          id="topic"
          autoFocus
          value={topic}
          maxLength={MAX_TOPIC}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="Kenapa browser memakan RAM lebih banyak dari video editor"
          className="mt-1.5 h-[70px] w-full resize-none rounded-[10px] border border-white/10 bg-rise px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-accent"
        />
        <p className="num mt-1 text-right text-[10.5px] text-faint">
          {topic.trim().length} / {MAX_TOPIC}
        </p>

        {ideas.length > 0 ? (
          <div className="mt-1.5 flex max-h-[168px] flex-col gap-1 overflow-y-auto rounded-[10px] border border-white/8 bg-sunk p-1.5">
            {ideas.map((idea) => (
              <button
                key={idea.title}
                type="button"
                onClick={() => {
                  setTopic(idea.title);
                  setIdeas([]);
                }}
                className="rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-rise"
              >
                <span className="block text-[12px] leading-snug text-ink">{idea.title}</span>
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-faint">
                  {idea.hook}
                </span>
              </button>
            ))}
            <p className="px-2.5 pb-0.5 pt-1 text-[10px] text-faint">
              Pick one to use it, or keep typing your own. Nothing is saved until you start a run.
            </p>
          </div>
        ) : null}

        <label htmlFor="language" className="mt-3 block text-[11px] font-medium text-dim">
          Language
        </label>
        <div className="mt-1.5 flex gap-2">
          <select
            id="language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="h-9 flex-1 cursor-pointer rounded-[10px] border border-white/10 bg-rise px-3 text-[13px] text-ink outline-none focus:border-accent"
          >
            {LANGUAGES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void preview(language)}
            disabled={previewing !== null}
            title="Hear how this language sounds"
            className="flex h-9 items-center gap-1.5 rounded-[10px] border border-white/10 bg-rise px-3 text-[12px] text-dim transition-colors hover:bg-lift hover:text-ink disabled:opacity-60"
          >
            {previewing === language ? (
              <Volume2 size={13} className="animate-pulse text-accent-hi" />
            ) : (
              <Play size={12} />
            )}
            {previewing === language ? 'Playing' : 'Hear it'}
          </button>
        </div>

        <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
          Script, scene plan and narration are all produced in this language. One voice per
          language — press <b className="text-dim">Hear it</b> to sample it before you commit.
        </p>

        {error ? (
          <p role="alert" className="mt-3 rounded-[10px] border border-err/25 bg-err/8 px-3 py-2 text-[12px] text-err">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || tooShort}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {busy ? 'Starting' : 'Start the run'}
          </Button>
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
          It runs in the background and takes several minutes. The row appears in the table as soon
          as the first step writes.
        </p>
      </form>
    </div>
  );
}
