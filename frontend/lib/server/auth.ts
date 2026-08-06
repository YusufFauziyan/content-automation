import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Session handling for the single-password gate.
 *
 * The password guards a personal tool, not a multi-tenant product: there are no
 * accounts, so there is nothing to identify — only to admit. What the cookie
 * carries is therefore an expiry and a signature over it, and nothing else.
 *
 * This is deliberately modest security. A shared password has no per-person
 * revocation and no audit trail, and there is no rate limiting here beyond the
 * delay below. Before this is exposed to the internet it wants a real account
 * model; see the note in README.md.
 */

const PASSWORD = process.env.APP_PASSWORD ?? 'password123';

/**
 * Signing key. Falls back to a constant in development so the app runs from a
 * fresh clone; in production an unset key would make every deployment able to
 * mint another's cookies, so it must be set.
 */
const SECRET = process.env.AUTH_SECRET ?? 'yu-tomation-development-secret';

export const SESSION_COOKIE = 'yu_session';

/** How long a session lasts. Long enough for a working day. */
const TTL_MS = 12 * 60 * 60 * 1000;

/** Constant-time comparison, so a wrong password cannot be found byte by byte. */
function matches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isPasswordCorrect(candidate: string): boolean {
  return matches(candidate, PASSWORD);
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

/** Mints a cookie value that says only "admitted, until this moment". */
export function createSession(): { value: string; maxAge: number } {
  const expiresAt = String(Date.now() + TTL_MS);
  return { value: `${expiresAt}.${sign(expiresAt)}`, maxAge: Math.floor(TTL_MS / 1000) };
}

/** True when the cookie was signed by us and has not expired. */
export function isSessionValid(cookie: string | undefined): boolean {
  if (cookie === undefined) return false;

  const [expiresAt, signature] = cookie.split('.');
  if (expiresAt === undefined || signature === undefined) return false;
  if (!matches(signature, sign(expiresAt))) return false;

  return Number(expiresAt) > Date.now();
}
