import { describe, expect, it } from 'vitest';

import {
  hasSignInCookies,
  importSession,
} from '../../../src/utils/credential/session-import.js';

/** The one cookie that makes a TikTok paste a sign-in rather than a visit. */
const signedIn = { name: 'sessionid', value: 'abc123', domain: '.tiktok.com' };

describe('importSession reading what somebody pasted', () => {
  it('takes the file the capture script writes', () => {
    const result = importSession(
      JSON.stringify({ cookies: [signedIn], origins: [{ origin: 'https://www.tiktok.com' }] }),
      'TIKTOK',
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.state.cookies[0]?.name).toBe('sessionid');
    expect(result.ok && result.state.origins).toHaveLength(1);
  });

  it('takes a bare cookie export from a browser extension', () => {
    // Extensions write an array, not a storage state, and spell things their
    // own way. Rejecting that would mean telling people to hand-edit JSON.
    const result = importSession(
      JSON.stringify([
        {
          name: 'sessionid',
          value: 'abc123',
          domain: '.tiktok.com',
          path: '/',
          expirationDate: 1_800_000_000.5,
          sameSite: 'no_restriction',
          hostOnly: false,
          storeId: '0',
        },
      ]),
      'TIKTOK',
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.state.cookies[0]).toMatchObject({
      name: 'sessionid',
      expires: 1_800_000_000,
      sameSite: 'None',
    });
  });

  it('drops fields no browser will replay', () => {
    const result = importSession(
      JSON.stringify([{ ...signedIn, hostOnly: false, storeId: '0', id: 7 }]),
      'TIKTOK',
    );

    expect(result.ok && Object.keys(result.state.cookies[0] ?? {})).not.toContain('storeId');
  });

  it('takes a Cookie header copied out of the network tab', () => {
    const result = importSession('tt_webid=999; sessionid=abc123; ttwid=xyz', 'TIKTOK');

    expect(result.ok).toBe(true);
    expect(result.ok && result.cookieCount).toBe(3);
    expect(result.ok && result.state.cookies.map((cookie) => cookie.name)).toContain('sessionid');
  });

  it('defaults a header cookie to the platform it was pasted for', () => {
    expect(importSession('sessionid=abc123', 'TIKTOK')).toMatchObject({
      state: { cookies: [{ domain: '.tiktok.com', path: '/', secure: true }] },
    });
    expect(importSession('SAPISID=abc123', 'YOUTUBE')).toMatchObject({
      state: { cookies: [{ domain: '.youtube.com' }] },
    });
  });

  it('says a paste is not signed in rather than storing an anonymous session', () => {
    // The commonest mistake is exporting cookies before logging in, or dumping
    // only the analytics ones. Stored, it fails days later in a scheduled run.
    expect(importSession('tt_webid=999; ttwid=xyz', 'TIKTOK')).toEqual({
      ok: false,
      reason: 'not-signed-in',
    });
  });

  it('judges a Google session by the cookie a signed request is derived from', () => {
    // `SID` alone is not enough to act as the account, and a paste with only
    // the analytics cookies is signed out however long it is.
    expect(importSession('VISITOR_INFO1_LIVE=abc; YSC=def', 'YOUTUBE')).toEqual({
      ok: false,
      reason: 'not-signed-in',
    });
    expect(importSession('SAPISID=abc; __Secure-1PSID=def', 'YOUTUBE').ok).toBe(true);
  });

  it('does not accept a TikTok session as a YouTube one', () => {
    // Pasting the wrong platform's cookies is easy when both are open in tabs.
    expect(importSession('sessionid=abc123', 'YOUTUBE')).toEqual({
      ok: false,
      reason: 'not-signed-in',
    });
  });

  it('tells an empty cookie list apart from an unreadable paste', () => {
    expect(importSession(JSON.stringify({ cookies: [], origins: [] }), 'TIKTOK')).toEqual({
      ok: false,
      reason: 'no-cookies',
    });
    expect(importSession('not a session at all', 'TIKTOK')).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(importSession('   ', 'TIKTOK')).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('accepts the secure-site variant of the sign-in cookie', () => {
    expect(importSession('sessionid_ss=abc123', 'TIKTOK').ok).toBe(true);
  });
});

describe('hasSignInCookies deciding when a capture is done', () => {
  it('says signed in once the cookie that authenticates a request exists', () => {
    expect(
      hasSignInCookies([{ name: 'SAPISID', domain: '.youtube.com' }], 'YOUTUBE'),
    ).toBe(true);
    expect(hasSignInCookies([{ name: 'sessionid', domain: '.tiktok.com' }], 'TIKTOK')).toBe(true);
  });

  it('does not mistake the visitor cookies for a sign-in', () => {
    // These are set on the first page load, signed in or not. Treating them as
    // a sign-in would save an anonymous session that fails days later.
    expect(
      hasSignInCookies(
        [
          { name: 'VISITOR_INFO1_LIVE', domain: '.youtube.com' },
          { name: 'YSC', domain: '.youtube.com' },
        ],
        'YOUTUBE',
      ),
    ).toBe(false);
  });

  it('wants the cookie on the platform it is capturing for', () => {
    // Signing in to Google sets these on google.com before youtube.com has
    // them. Accepting the wrong domain saves a session YouTube will not honour.
    expect(hasSignInCookies([{ name: 'SAPISID', domain: '.google.com' }], 'YOUTUBE')).toBe(false);
    expect(hasSignInCookies([{ name: 'sessionid', domain: '.tiktok.com' }], 'YOUTUBE')).toBe(false);
  });

  it('agrees with what importSession would accept', () => {
    // The capture must never produce a session the credential store then
    // rejects. Both ask the same question of the same names, so they cannot
    // drift into disagreeing.
    const live = [{ name: 'SAPISID', value: 'abc', domain: '.youtube.com' }];

    expect(hasSignInCookies(live, 'YOUTUBE')).toBe(true);
    expect(importSession(JSON.stringify({ cookies: live, origins: [] }), 'YOUTUBE').ok).toBe(true);
  });
});
