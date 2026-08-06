'use client';

import { Clapperboard, Loader2, LockKeyhole } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Could not sign in.');
      setBusy(false);
      setPassword('');
      return;
    }

    // A full navigation, so the middleware sees the new cookie.
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full max-w-[340px]">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-node-ai to-accent">
          <Clapperboard size={15} className="text-on-accent" strokeWidth={2.2} />
        </span>
        <div>
          <p className="text-[14px] font-semibold tracking-[-0.015em]">Yu-tomation</p>
          <p className="text-[11px] text-faint">Studio workspace</p>
        </div>
      </div>

      <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Sign in</h1>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">
        One password guards this workspace. There are no accounts.
      </p>

      <label htmlFor="password" className="mt-6 block text-[11px] font-medium text-dim">
        Password
      </label>
      <div className="relative mt-1.5">
        <LockKeyhole
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
        />
        <input
          id="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={error !== null}
          aria-describedby={error ? 'password-error' : undefined}
          className="h-10 w-full rounded-[10px] border border-white/10 bg-rise pl-9 pr-3 text-[13px] text-ink outline-none transition-colors focus:border-accent"
          placeholder="Enter the workspace password"
        />
      </div>

      {error ? (
        <p id="password-error" role="alert" className="mt-2 text-[12px] text-err">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || password === ''}
        className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-accent text-[13.5px] font-medium text-on-accent transition-colors hover:bg-accent-hi disabled:opacity-50"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : null}
        {busy ? 'Checking' : 'Sign in'}
      </button>

      <p className="mt-5 text-[11px] leading-relaxed text-faint">
        Set <code className="mono text-dim">APP_PASSWORD</code> to change it. Unset, it is{' '}
        <code className="mono text-dim">password123</code>.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-void px-6 text-ink">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
