/**
 * Captures a TikTok sign-in for the uploader to replay.
 *
 * Run with `pnpm tiktok:login`. A real browser opens, you sign in by hand —
 * captcha, SMS, two-factor and all — and the resulting session is written to a
 * file you paste into Credentials.
 *
 * Deliberately a script and not part of the server. Signing in needs a person
 * at a keyboard, which is exactly what a server does not have, and building it
 * into the application would mean the application holding a password. It never
 * does: the password is typed into TikTok's own page, and only what TikTok
 * hands back afterwards leaves this script.
 *
 * The written file is a live credential — anyone holding it can post as the
 * account. It goes to `output/`, which is git-ignored, and the script says to
 * delete it once pasted.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import {
  hasSignInCookies,
  type SessionPlatform,
} from '../src/utils/credential/session-import.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const outputPath = (file: string): string => resolve(HERE, '../output', file);

/** Where signing in starts. Overridable for the same reason the uploader is. */
const PLATFORM = (process.argv[2] ?? 'tiktok').toLowerCase();

/** Where signing in starts, and what a finished sign-in looks like. */
const PLATFORMS: Record<string, { loginUrl: string; platform: SessionPlatform; file: string }> = {
  tiktok: {
    loginUrl: process.env['TIKTOK_LOGIN_URL'] ?? 'https://www.tiktok.com/login',
    platform: 'TIKTOK',
    file: 'tiktok-session.json',
  },
  youtube: {
    loginUrl:
      process.env['YOUTUBE_LOGIN_URL'] ??
      'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
    platform: 'YOUTUBE',
    file: 'youtube-session.json',
  },
};

const target = PLATFORMS[PLATFORM];

if (target === undefined) {
  console.error(`\n  Unknown platform "${PLATFORM}". Use tiktok or youtube.\n`);
  process.exit(1);
}

const LOGIN_URL = target.loginUrl;

/**
 * Pages that mean "signed in".
 *
 * Checked so the script can tell you it worked rather than writing whatever
 * state the browser happened to be in — a saved signed-out session fails much
 * later, in a scheduled run, with nobody watching.
 */

const main = async (): Promise<void> => {
  console.log(`\n  Opening a browser. Sign in to ${PLATFORM} in that window.`);
  console.log('  Nothing you type there passes through this script.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(LOGIN_URL);

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  await prompt.question('  Press Enter here once you are signed in and can see your feed… ');
  prompt.close();

  // Asked of the cookies, not the address bar: Google finishes a sign-in on
  // whichever page it feels like, and a URL pattern that covers today's
  // landing page silently stops covering tomorrow's.
  if (!hasSignInCookies(await context.cookies(), target.platform)) {
    console.error(`\n  That still looks signed out (${page.url()}).`);
    console.error('  Nothing was written. Run it again and finish signing in first.\n');
    await browser.close();
    process.exitCode = 1;

    return;
  }

  const state = await context.storageState();
  const savedTo = outputPath(target.file);
  await mkdir(dirname(savedTo), { recursive: true });
  await writeFile(savedTo, JSON.stringify(state, null, 2), 'utf8');
  await browser.close();

  console.log(`\n  Session saved to ${savedTo}`);
  console.log('  It holds %d cookies.\n', state.cookies.length);
  console.log('  Next:');
  console.log('    1. Open Credentials → TikTok → Connect → Browser session');
  console.log('    2. Paste the whole file into the session field');
  console.log('    3. Delete the file — it can post as you until it expires\n');
};

await main();
