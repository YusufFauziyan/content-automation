'use client';

import {
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { CaptureState } from '@/lib/server/backend';
import { cn } from '@/lib/utils';

export type Platform = 'TIKTOK' | 'INSTAGRAM' | 'THREADS' | 'YOUTUBE';
export type AuthMethod = 'API' | 'BROWSER';

export interface CredentialRow {
  id: string;
  platform: Platform;
  authMethod: AuthMethod;
  label: string;
  fieldNames: string[];
  enabled: boolean;
  lastUsedAt: string | null;
}

interface Field {
  name: string;
  label: string;
  /** Rendered as a textarea, and never masked — a session is too long to check by eye. */
  long?: boolean;
}

/**
 * What each platform needs, and what to call it in front of a person.
 *
 * Keyed by sign-in method as well as platform, mirroring the backend: it
 * refuses a credential missing a field, and asking for the wrong things here
 * would only produce an error after the paste. A method a platform does not
 * have is absent rather than empty, so the form cannot offer it.
 */
const PLATFORMS: Record<
  Platform,
  { label: string; tint: string; methods: Partial<Record<AuthMethod, Field[]>> }
> = {
  TIKTOK: {
    label: 'TikTok',
    tint: 'text-node-upload',
    methods: {
      API: [
        { name: 'clientKey', label: 'Client key' },
        { name: 'clientSecret', label: 'Client secret' },
        { name: 'accessToken', label: 'Access token' },
        { name: 'refreshToken', label: 'Refresh token' },
      ],
      BROWSER: [{ name: 'storageState', label: 'Session file', long: true }],
    },
  },
  INSTAGRAM: {
    label: 'Instagram',
    tint: 'text-node-ai',
    methods: {
      API: [
        { name: 'appId', label: 'App ID' },
        { name: 'appSecret', label: 'App secret' },
        { name: 'accessToken', label: 'Access token' },
        { name: 'igUserId', label: 'Instagram user ID' },
      ],
    },
  },
  THREADS: {
    label: 'Threads',
    tint: 'text-ink',
    methods: {
      API: [
        { name: 'appId', label: 'App ID' },
        { name: 'appSecret', label: 'App secret' },
        { name: 'accessToken', label: 'Access token' },
        { name: 'threadsUserId', label: 'Threads user ID' },
      ],
    },
  },
  YOUTUBE: {
    label: 'YouTube',
    tint: 'text-node-video',
    methods: {
      API: [
        { name: 'clientId', label: 'Client ID' },
        { name: 'clientSecret', label: 'Client secret' },
        { name: 'refreshToken', label: 'Refresh token' },
      ],
      BROWSER: [{ name: 'storageState', label: 'Session file', long: true }],
    },
  },
};

/**
 * What to tell somebody exporting cookies, per platform.
 *
 * The cookie named here is the one the backend checks for, so the instruction
 * and the validation cannot drift apart into "paste this" / "that is wrong".
 */
const SESSION_HELP: Record<Platform, { domain: string; script: string; cookie: string }> = {
  TIKTOK: { domain: 'tiktok.com', script: 'pnpm tiktok:login', cookie: 'sessionid' },
  YOUTUBE: { domain: 'youtube.com', script: 'pnpm youtube:login', cookie: 'SAPISID' },
  INSTAGRAM: { domain: 'instagram.com', script: '—', cookie: 'sessionid' },
  THREADS: { domain: 'threads.net', script: '—', cookie: 'sessionid' },
};

/** How each sign-in method is described where one is chosen. */
const METHODS: Record<AuthMethod, { label: string; hint: string; icon: typeof KeyRound }> = {
  API: {
    label: 'Official API',
    hint: 'OAuth tokens from the platform\u2019s developer console.',
    icon: KeyRound,
  },
  BROWSER: {
    label: 'Browser session',
    hint: 'Sign in once in a real browser. Expires on its own.',
    icon: Globe,
  },
};

/** How often to ask whether somebody has finished signing in. */
const POLL_MS = 2_000;

/**
 * Watches a sign-in that is happening in a browser window elsewhere.
 *
 * Polled rather than streamed: this is one short-lived question asked a few
 * dozen times at most, and a socket for it would be more machinery than the
 * thing it watches.
 */
function useCapture(onSaved: () => void) {
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(onSaved);
  saved.current = onSaved;

  useEffect(() => {
    if (capture === null || capture.status === 'SAVED' || capture.status === 'FAILED') return;

    const timer = setInterval(() => {
      void (async () => {
        const response = await fetch(`/api/credentials/capture/${capture.id}`);

        if (!response.ok) {
          // The backend forgets a capture a minute after it settles. Losing
          // track of one is not the same as it having failed, so it is not
          // reported as one.
          setCapture(null);
          return;
        }

        const next = (await response.json()) as CaptureState;
        setCapture(next);

        if (next.status === 'SAVED') saved.current();
        if (next.status === 'FAILED') setError(next.message ?? 'Signing in did not finish.');
      })();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [capture]);

  async function begin(platform: Platform, label: string) {
    setError(null);

    const response = await fetch('/api/credentials/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, label }),
    });
    const body = (await response.json().catch(() => ({}))) as CaptureState & { error?: string };

    if (!response.ok) {
      setError(body.error ?? 'A browser could not be opened.');
      return;
    }

    setCapture(body);
  }

  const waiting = capture?.status === 'WAITING' || capture?.status === 'SAVING';

  return { begin, waiting, error };
}

const ORDER: Platform[] = ['TIKTOK', 'INSTAGRAM', 'THREADS', 'YOUTUBE'];

/**
 * The accounts videos can be published to.
 *
 * No secret is ever displayed, because none is ever sent: the server returns
 * the handle and which fields it holds, and nothing that could be pasted
 * somewhere else. Replacing a credential means entering it again — which is
 * the correct cost for never having it leave the server.
 */
export function CredentialsPanel({ credentials }: { credentials: CredentialRow[] }) {
  const router = useRouter();
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, request: () => Promise<Response>, whatFailed: string) {
    setBusy(id);
    setError(null);

    const response = await request();
    setBusy(null);

    if (!response.ok) {
      setError(whatFailed);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5 rounded-[12px] border border-white/8 bg-rise/40 px-4 py-3">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-ok" />
        <p className="text-[12px] leading-relaxed text-dim">
          Secrets are encrypted before they are written and never sent back — this page can show
          that an account is connected, not what it contains. Losing the database does not lose the
          accounts; losing <code className="mono text-faint">CREDENTIALS_KEY</code> does.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-[12px] border border-err/25 bg-err/8 px-3.5 py-2.5 text-[12.5px] text-dim">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {ORDER.map((platform) => {
          const meta = PLATFORMS[platform];
          const connected = credentials.filter((entry) => entry.platform === platform);

          return (
            <section
              key={platform}
              className="rounded-[16px] border border-white/8 bg-rise/40 p-4"
            >
              <div className="flex items-center gap-2.5">
                <span className={cn('grid size-8 place-items-center rounded-[10px] bg-white/5', meta.tint)}>
                  <KeyRound size={15} />
                </span>
                <div className="flex-1">
                  <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">{meta.label}</h2>
                  <p className="text-[10.5px] text-faint">
                    {connected.length === 0
                      ? 'No account connected'
                      : `${connected.length} account${connected.length === 1 ? '' : 's'}`}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setConnecting(platform)}>
                  <Plus size={11} /> Connect
                </Button>
              </div>

              {connected.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {connected.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-2 rounded-[10px] border border-white/6 bg-sunk px-2.5 py-2"
                    >
                      <Lock size={11} className="shrink-0 text-faint" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-ink">{entry.label}</span>
                        <span className="mono block truncate text-[10px] text-faint">
                          {METHODS[entry.authMethod].label} · {entry.fieldNames.join(' · ')}
                        </span>
                      </span>

                      <button
                        onClick={() =>
                          void act(
                            entry.id,
                            () =>
                              fetch(`/api/credentials/${entry.id}`, {
                                method: 'PATCH',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ enabled: !entry.enabled }),
                              }),
                            'That account could not be changed.',
                          )
                        }
                        disabled={busy === entry.id}
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                          entry.enabled
                            ? 'bg-ok/12 text-ok hover:bg-ok/20'
                            : 'bg-white/6 text-faint hover:bg-white/10',
                        )}
                      >
                        {busy === entry.id ? '…' : entry.enabled ? 'Active' : 'Paused'}
                      </button>

                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${entry.label}`}
                        disabled={busy === entry.id}
                        onClick={() =>
                          void act(
                            entry.id,
                            () =>
                              fetch('/api/credentials', {
                                method: 'DELETE',
                                headers: { 'content-type': 'application/json' },
                                body: JSON.stringify({ ids: [entry.id] }),
                              }),
                            'That account could not be removed.',
                          )
                        }
                      >
                        <Trash2 size={11} />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      {connecting ? (
        <ConnectDialog platform={connecting} onClose={() => setConnecting(null)} />
      ) : null}
    </div>
  );
}

function ConnectDialog({ platform, onClose }: { platform: Platform; onClose: () => void }) {
  const router = useRouter();
  const meta = PLATFORMS[platform];
  const available = Object.keys(meta.methods) as AuthMethod[];
  const [method, setMethod] = useState<AuthMethod>(available[0] ?? 'API');
  const [label, setLabel] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capture = useCapture(() => {
    onClose();
    router.refresh();
  });

  const required = meta.methods[method] ?? [];
  const complete =
    label.trim() !== '' && required.every((f) => (fields[f.name] ?? '').trim() !== '');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, authMethod: method, label: label.trim(), fields }),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? 'That account could not be connected.');
      return;
    }

    onClose();
    router.refresh();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-title"
      className="fixed inset-0 z-50 grid place-items-center bg-void/70 p-6 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-[440px] overflow-y-auto rounded-[16px] border border-white/10 bg-base p-5 shadow-[0_24px_60px_-20px_var(--shadow-modal)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 id="connect-title" className="text-[14.5px] font-semibold tracking-[-0.01em]">
              Connect {meta.label}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              These are encrypted before they are stored and cannot be read back. To change one,
              enter it again.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-faint hover:text-ink">
            <X size={15} />
          </button>
        </div>

        {available.length > 1 ? (
          <div className="mt-4 grid gap-1.5" role="radiogroup" aria-label="How the account signs in">
            {available.map((option) => {
              const detail = METHODS[option];
              const Icon = detail.icon;
              const chosen = option === method;

              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  onClick={() => setMethod(option)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                    chosen
                      ? 'border-accent/50 bg-accent/8'
                      : 'border-white/8 bg-rise/40 hover:border-white/16',
                  )}
                >
                  <Icon size={14} className={cn('mt-0.5 shrink-0', chosen ? 'text-accent' : 'text-faint')} />
                  <span>
                    <span className="block text-[12.5px] font-medium text-ink">{detail.label}</span>
                    <span className="block text-[11px] leading-relaxed text-faint">{detail.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <label htmlFor="handle" className="mt-4 block text-[11px] font-medium text-dim">
          Account handle
        </label>
        <input
          id="handle"
          autoFocus
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="@yu.tomation"
          className="mt-1.5 h-9 w-full rounded-[10px] border border-white/10 bg-rise px-3 text-[13px] text-ink outline-none focus:border-accent"
        />

        {method === 'BROWSER' ? (
          <div className="mt-3 rounded-[12px] border border-white/8 bg-sunk px-3.5 py-3">
            <p className="text-[11.5px] leading-relaxed text-dim">
              A browser opens on the machine running the backend. Sign in there — captcha, SMS and
              two-factor included — and the session saves itself. Your password is typed into{' '}
              {meta.label}&rsquo;s own page and never passes through Yu-tomation.
            </p>

            <Button
              type="button"
              variant="outline"
              className="mt-2.5 w-full"
              disabled={capture.waiting || label.trim() === ''}
              onClick={() => void capture.begin(platform, label.trim())}
            >
              {capture.waiting ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Waiting for you to sign in…
                </>
              ) : (
                <>
                  <Globe size={13} /> Open a browser and sign in
                </>
              )}
            </Button>

            {label.trim() === '' ? (
              <p className="mt-2 text-[11px] text-faint">Enter the account handle above first.</p>
            ) : null}

            {capture.error ? (
              <p role="alert" className="mt-2 text-[11px] leading-relaxed text-err">
                {capture.error}
              </p>
            ) : null}

            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] text-faint hover:text-dim">
                Sign-in refused, or backend on another machine? Paste cookies instead
              </summary>
              <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-faint">
                <p>
                  Both platforms sometimes refuse to finish a sign-in in a browser they can tell is
                  automated — the QR scans and nothing happens. Logging in with your own everyday
                  browser always works, so take the cookies from there instead. Any of these pastes
                  into the box below:
                </p>
                <ul className="ml-3 list-disc space-y-1">
                  <li>
                    A cookie export for <span className="text-dim">{SESSION_HELP[platform].domain}</span>{' '}
                    from an extension like Cookie-Editor — the whole array.
                  </li>
                  <li>
                    The <code className="mono text-dim">cookie:</code> header from DevTools →
                    Network → any {SESSION_HELP[platform].domain} request → Request Headers.
                  </li>
                  <li>
                    The file from{' '}
                    <code className="mono text-dim">{SESSION_HELP[platform].script}</code>, if you
                    ran it elsewhere.
                  </li>
                </ul>
                <p className="flex items-start gap-2">
                  <Terminal size={12} className="mt-0.5 shrink-0" />
                  <span>
                    Log in first, then export — cookies taken while signed out carry no{' '}
                    <code className="mono text-dim">{SESSION_HELP[platform].cookie}</code> and are
                    refused here rather than failing next week. Delete whatever you copied
                    afterwards: it can post as you until it expires, usually about two months.
                  </span>
                </p>
              </div>
            </details>
          </div>
        ) : null}

        {required.map((field) => (
          <div key={field.name}>
            <label htmlFor={field.name} className="mt-3 block text-[11px] font-medium text-dim">
              {field.label}
            </label>
            {field.long ? (
              // Not masked: a paste this size has to be visible to tell a good
              // one from an empty one, and it is about to be sealed anyway.
              <textarea
                id={field.name}
                rows={5}
                spellCheck={false}
                placeholder={'sessionid=…; ttwid=…\n\nor a cookie export, or the capture file'}
                value={fields[field.name] ?? ''}
                onChange={(event) =>
                  setFields((current) => ({ ...current, [field.name]: event.target.value }))
                }
                className="mono mt-1.5 w-full resize-y rounded-[10px] border border-white/10 bg-rise px-3 py-2 text-[11px] leading-relaxed text-ink outline-none focus:border-accent"
              />
            ) : (
              <input
                id={field.name}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={fields[field.name] ?? ''}
                onChange={(event) =>
                  setFields((current) => ({ ...current, [field.name]: event.target.value }))
                }
                className="mono mt-1.5 h-9 w-full rounded-[10px] border border-white/10 bg-rise px-3 text-[12px] text-ink outline-none focus:border-accent"
              />
            )}
          </div>
        ))}

        {error ? (
          <p role="alert" className="mt-3 rounded-[10px] border border-err/25 bg-err/8 px-3 py-2 text-[12px] text-err">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !complete}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
            {busy ? 'Encrypting' : 'Connect'}
          </Button>
        </div>
      </form>
    </div>
  );
}
