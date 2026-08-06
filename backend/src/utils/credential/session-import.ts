/**
 * Turning whatever somebody pasted into a session a browser can replay.
 *
 * There is more than one way to get a signed-in session out of a browser, and
 * none of them is obviously the right one to a person doing it for the first
 * time. Rather than name a format and reject the other two, this accepts all of
 * them:
 *
 * - the JSON written by `pnpm tiktok:login` (Playwright's storage state)
 * - a cookie export from a browser extension, which is a bare array
 * - the `Cookie:` header copied out of the network tab, which is one line
 *
 * Everything is normalised to Playwright's storage state, so exactly one shape
 * is ever stored and the uploader has one thing to understand.
 */

/** A cookie as Playwright wants it back. */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/** A storage state, as stored and as replayed. */
export interface SessionState {
  cookies: SessionCookie[];
  origins: unknown[];
}

/** What a paste turned out to be. */
export type SessionImport =
  | { readonly ok: true; readonly state: SessionState; readonly cookieCount: number }
  | { readonly ok: false; readonly reason: 'unreadable' | 'no-cookies' | 'not-signed-in' };

/**
 * Cookie names that actually carry a sign-in, per platform.
 *
 * Checked because the commonest mistake is pasting a full cookie dump that is
 * mostly analytics: without one of these the session is anonymous, and it fails
 * later, in a scheduled run, with nothing to point at.
 *
 * TikTok: `sessionid`, or the `_ss` variant the secure-site flow sets.
 * Google: `SID` alone is not enough for an authenticated request — `SAPISID` is
 * what the signed request header is derived from, and `__Secure-1PSID` is what
 * survives on the newer accounts.
 */
export const SIGN_IN_COOKIES: Readonly<Record<SessionPlatform, readonly string[]>> = {
  TIKTOK: ['sessionid', 'sessionid_ss'],
  YOUTUBE: ['SAPISID', '__Secure-1PSID', '__Secure-3PSID', 'SID'],
};

/** Where cookies belong when a paste did not say. */
const DEFAULT_DOMAIN: Readonly<Record<SessionPlatform, string>> = {
  TIKTOK: '.tiktok.com',
  YOUTUBE: '.youtube.com',
};

/** Platforms a browser session can be captured for. */
export type SessionPlatform = 'TIKTOK' | 'YOUTUBE';

/** Extensions spell `sameSite` several ways; Playwright accepts three. */
const SAME_SITE: Readonly<Record<string, SessionCookie['sameSite']>> = {
  strict: 'Strict',
  lax: 'Lax',
  none: 'None',
  no_restriction: 'None',
  unspecified: 'Lax',
};

/** A cookie as some browser extension happened to write it. */
interface ForeignCookie {
  name?: unknown;
  value?: unknown;
  domain?: unknown;
  path?: unknown;
  expires?: unknown;
  expirationDate?: unknown;
  httpOnly?: unknown;
  secure?: unknown;
  sameSite?: unknown;
}

/**
 * Whether a live browser is signed in to `platform`.
 *
 * Asked of the cookies rather than of the address bar, because the address bar
 * does not know. Google finishes a sign-in on `youtube.com/`, on
 * `myaccount.google.com`, or on whichever page it was interrupted from — a
 * URL pattern that covers today's landing page silently stops covering
 * tomorrow's, and the symptom is a capture that waits for ever with somebody
 * already logged in on the other side of the screen.
 *
 * The cookies are the thing that makes a request authenticated, so their
 * presence *is* being signed in. It also means a capture can never produce a
 * session that {@link importSession} would go on to reject: both ask the same
 * question of the same names.
 */
export const hasSignInCookies = (
  cookies: readonly { name: string; domain: string }[],
  platform: SessionPlatform,
): boolean => {
  const wanted = SIGN_IN_COOKIES[platform];
  const host = DEFAULT_DOMAIN[platform].replace(/^\./, '');

  return cookies.some(
    (cookie) => wanted.includes(cookie.name) && cookie.domain.includes(host),
  );
};

/** Reads `value` as JSON, or null when it is not JSON at all. */
const asJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

/**
 * One foreign cookie, in Playwright's shape.
 *
 * Unknown fields are dropped rather than carried: a cookie export contains
 * `hostOnly`, `storeId` and an id per row, and none of it means anything to the
 * browser that will replay this.
 */
const toCookie = (raw: ForeignCookie, platform: SessionPlatform): SessionCookie | null => {
  if (typeof raw.name !== 'string' || raw.name === '') return null;
  if (typeof raw.value !== 'string') return null;

  // Extensions write `expirationDate` in seconds; Playwright wants `expires`
  // in seconds too, with -1 meaning "goes when the browser does".
  const expiry = typeof raw.expires === 'number' ? raw.expires : raw.expirationDate;
  const sameSite =
    typeof raw.sameSite === 'string' ? SAME_SITE[raw.sameSite.toLowerCase()] : undefined;

  return {
    name: raw.name,
    value: raw.value,
    domain:
      typeof raw.domain === 'string' && raw.domain !== '' ? raw.domain : DEFAULT_DOMAIN[platform],
    path: typeof raw.path === 'string' && raw.path !== '' ? raw.path : '/',
    expires: typeof expiry === 'number' ? Math.floor(expiry) : -1,
    httpOnly: raw.httpOnly === true,
    // Defaulted to true because the cookies that matter here are: a secure
    // cookie replayed as insecure is simply not sent.
    secure: raw.secure !== false,
    sameSite: sameSite ?? 'Lax',
  };
};

/** Parses a `Cookie:` header — `a=1; b=2` — into cookies for one domain. */
const fromHeader = (line: string, platform: SessionPlatform): SessionCookie[] =>
  line
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes('='))
    .map((pair) => {
      const split = pair.indexOf('=');

      return toCookie(
        { name: pair.slice(0, split).trim(), value: pair.slice(split + 1).trim() },
        platform,
      );
    })
    .filter((cookie): cookie is SessionCookie => cookie !== null);

/** Pulls a cookie list out of whichever of the three shapes was pasted. */
const readCookies = (pasted: string, platform: SessionPlatform): SessionCookie[] | null => {
  const parsed = asJson(pasted);

  // A storage state, as written by the capture script.
  if (typeof parsed === 'object' && parsed !== null && 'cookies' in parsed) {
    const { cookies } = parsed;

    if (!Array.isArray(cookies)) return null;

    return (cookies as ForeignCookie[])
      .map((cookie) => toCookie(cookie, platform))
      .filter((cookie): cookie is SessionCookie => cookie !== null);
  }

  // A bare export from a cookie extension.
  if (Array.isArray(parsed)) {
    return (parsed as ForeignCookie[])
      .map((cookie) => toCookie(cookie, platform))
      .filter((cookie): cookie is SessionCookie => cookie !== null);
  }

  // Not JSON. The remaining possibility is a header line.
  return parsed === null && pasted.includes('=') ? fromHeader(pasted, platform) : null;
};

/**
 * Normalises a paste into a storage state, or says what was wrong with it.
 *
 * The three failures are kept apart because they need three different things
 * from the person who pasted: read the file again, export the cookies too, or
 * sign in first.
 */
export const importSession = (pasted: string, platform: SessionPlatform): SessionImport => {
  const trimmed = pasted.trim();

  if (trimmed === '') return { ok: false, reason: 'unreadable' };

  const cookies = readCookies(trimmed, platform);

  if (cookies === null) return { ok: false, reason: 'unreadable' };
  if (cookies.length === 0) return { ok: false, reason: 'no-cookies' };
  if (!cookies.some((cookie) => SIGN_IN_COOKIES[platform].includes(cookie.name))) {
    return { ok: false, reason: 'not-signed-in' };
  }

  // `origins` — local storage — is preserved when it was there and empty when
  // it was not. Cookies alone are enough to be signed in; the origins only make
  // some pages render without a reload.
  const parsed = asJson(trimmed);
  const origins =
    typeof parsed === 'object' && parsed !== null && 'origins' in parsed ? parsed.origins : [];

  return {
    ok: true,
    state: { cookies, origins: Array.isArray(origins) ? origins : [] },
    cookieCount: cookies.length,
  };
};
