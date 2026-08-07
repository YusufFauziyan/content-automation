import { chromium, type Browser, type Locator, type Page } from 'playwright';

import type { BrowserPublishConfig } from '../config/app.config.js';
import {
  PublishFailedError,
  PublishSessionExpiredError,
  PublishTimeoutError,
} from '../types/errors/publish.error.js';
import type { Logger } from '../types/logger.js';
import { hasSignInCookies } from '../utils/credential/session-import.js';
import type {
  PlaywrightService,
  PublishRequest,
  PublishResult,
} from './playwright.service.js';
import { captionWithTags } from './playwright.service.js';

/**
 * The parts of YouTube Studio this depends on.
 *
 * The same fragile surface as TikTok's, named in one place for the same reason.
 * Studio is a Polymer application: almost nothing has a stable class, but the
 * custom element names and `id` attributes have outlived several redesigns, so
 * those are preferred over anything that looks like styling.
 */
const SELECTORS = {
  fileInput: ['input[type="file"]'],
  title: [
    '#title-textarea #textbox',
    'ytcp-social-suggestions-textbox#title-textarea #textbox',
    'ytcp-form-input-container#title-textarea #textbox',
    '[id="title-textarea"] [id="textbox"]',
  ],
  description: [
    '#description-textarea #textbox',
    '#description-container #textbox',
    'ytcp-social-suggestions-textbox#description-textarea #textbox',
    '[id="description-textarea"] [id="textbox"]',
  ],
  /** "No, it's not made for kids" — Studio refuses to continue until one is picked. */
  notForKids: [
    'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
    'ytkc-made-for-kids-select tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
    '#audience tp-yt-paper-radio-button:has-text("not made for kids")',
    'tp-yt-paper-radio-button:has-text("not \'Made for Kids\'")',
    'tp-yt-paper-radio-button:has-text("not made for kids")',
    'tp-yt-paper-radio-button:has-text("No, it\'s not")',
    '#radio-button:has-text("No, it\'s not")',
    '[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
  ],
  forKids: [
    'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_MFK"]',
    'ytkc-made-for-kids-select tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_MFK"]',
    '#audience tp-yt-paper-radio-button:has-text("Yes, it\'s made for kids")',
    'tp-yt-paper-radio-button:has-text("Yes, it\'s Made for Kids")',
    'tp-yt-paper-radio-button:has-text("Yes, it\'s made for kids")',
    '[name="VIDEO_MADE_FOR_KIDS_MFK"]',
  ],
  /** Studio's custom-thumbnail picker. Only offered to verified channels. */
  thumbnailInput: [
    '#file-loader',
    'ytcp-thumbnail-uploader input[type="file"]',
    'ytcp-uploads-dialog input[type="file"]#file-loader',
  ],
  /**
   * Studio's "unsupported browser" interstitial, and the way past it.
   *
   * Shown to anything it does not recognise — which includes a browser started
   * by a tool, however ordinary it otherwise looks. Nothing renders behind it,
   * so every selector after this point misses and the failure reads as "the
   * page has probably changed" when the page is fine and simply not shown.
   */
  skipInterstitial: [
    'a:has-text("Skip to YouTube Studio")',
    'text=/skip to youtube studio/i',
  ],
  /** Opens the uploader when Studio lands on the dashboard instead of it. */
  createButton: [
    '#create-icon',
    'ytcp-button#create-icon',
    'button[aria-label*="Create"]',
    '[id="create-icon"]',
  ],
  uploadVideos: [
    'tp-yt-paper-item:has-text("Upload videos")',
    'text=/upload videos/i',
    '#text-item:has-text("Upload videos")',
  ],
  next: [
    '#next-button',
    'ytcp-button#next-button',
    'ytcp-button:has-text("Next")',
    'button:has-text("Next")',
    'tp-yt-paper-button:has-text("Next")',
    '[id="next-button"]',
  ],
  /** The visibility step's public option. */
  public: [
    'tp-yt-paper-radio-button[name="PUBLIC"]',
    '#privacy-radios tp-yt-paper-radio-button:has-text("Public")',
    'tp-yt-paper-radio-button:has-text("Public")',
    '#first-container tp-yt-paper-radio-button[name="PUBLIC"]',
    '[name="PUBLIC"]',
  ],
  done: [
    '#done-button',
    'ytcp-button#done-button',
    'ytcp-button:has-text("Save")',
    'ytcp-button:has-text("Publish")',
    'button:has-text("Save")',
    'button:has-text("Publish")',
    '[id="done-button"]',
  ],
  /**
   * The watch link, which Studio shows on the very first screen.
   *
   * Read there rather than after publishing: it is available while the file is
   * still processing, so a run that stumbles later still knows where the video
   * went. Hunting for it at the end was how a published video came back with no
   * link at all.
   */
  shareLink: [
    'a[href*="youtube.com/shorts/"]',
    'a[href*="youtu.be/"]',
    'a[href*="/watch?v="]',
    'a.ytcp-video-info',
    'span.video-url-fadeable a',
  ],
  /** Studio's confirmation once the wizard is finished with. */
  published: [
    'text=/video published/i',
    'text=/processing will begin/i',
    'ytcp-uploads-still-processing-dialog',
    'ytcp-video-share-dialog',
  ],
  /** Present only when the session is no longer signed in. */
  signedOut: ['input[type="email"]', 'text=/sign in/i'],
} as const;

/** Studio walks four screens; the last one is Visibility. */
const WIZARD_STEPS = 3;

/** YouTube truncates a title past this, so it is cut here where it is visible. */
const TITLE_LIMIT = 100;

/**
 * How long to wait for something that may simply not be there.
 *
 * Only for that. Waiting for the *next screen of the wizard* with this is what
 * made a working upload report "the page has probably changed": Studio takes
 * ten to fifteen seconds to hand over from the file picker to the details form,
 * and two seconds of looking finds nothing every time.
 */
const PROBE_MS = 2_000;
const SIGN_IN_POLL_MS = 1_000;
const LINK_LOOKUP_MS = 20_000;

/** What makes an automated Chrome look like an ordinary one. See the TikTok service. */
const UNDETECTABLE = [
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
];

/** A watch id out of either URL shape Studio offers. */
const VIDEO_ID = /(?:youtu\.be\/|[?&]v=)([\w-]{6,})/;

/** The stored session as Playwright wants it, or a failure that says so. */
type StorageState = NonNullable<NonNullable<Parameters<Browser['newContext']>[0]>['storageState']>;

const parseSession = (storageState: string): StorageState => {
  try {
    return JSON.parse(storageState) as StorageState;
  } catch {
    throw new PublishSessionExpiredError('YouTube', {
      reason: 'the stored session is not readable JSON',
    });
  }
};

/**
 * Publishes to YouTube by driving YouTube Studio.
 *
 * External system: Playwright driving studio.youtube.com.
 *
 * A separate class from the TikTok publisher rather than a branch inside it:
 * the two share a contract and nothing else. Studio is a four-screen wizard
 * with a mandatory audience question; TikTok is one page. Folding them together
 * would produce a method that is mostly `if (platform === …)`, and every future
 * change to either would have to be read against the other.
 *
 * Uploads land as **public** and the video is left processing — YouTube makes a
 * Short out of anything vertical and under three minutes on its own, so nothing
 * here has to ask for one.
 */
export class YouTubePublishService implements PlaywrightService {
  constructor(
    private readonly config: BrowserPublishConfig,
    private readonly logger: Logger,
  ) {}

  public async publish(request: PublishRequest): Promise<PublishResult> {
    const browser = await this.launch(this.config.headless);

    try {
      const context = await browser.newContext({
        storageState: parseSession(request.session.storageState),
      });
      context.setDefaultTimeout(this.config.timeoutMs);

      const page = await context.newPage();
      await page.goto(this.config.uploadUrl, { waitUntil: 'domcontentloaded' });

      if (await this.present(page, SELECTORS.signedOut)) {
        throw new PublishSessionExpiredError('YouTube', { uploadUrl: this.config.uploadUrl });
      }

      await this.openUploader(page);
      await this.attach(page, request.videoPath);

      // Read before anything can go wrong. Studio publishes the link to this
      // panel as soon as the file lands, and everything after here is a form.
      const link = await this.readLink(page);

      await this.describe(page, request);
      await this.setThumbnail(page, request.coverPath);
      await this.answerAudience(page);
      await this.walkToVisibility(page);
      await this.makePublic(page);

      const result = await this.finish(page, link);

      this.logger.info('Published a video to YouTube', {
        source: YouTubePublishService.name,
        externalId: result.externalId,
        linkKnown: result.externalUrl !== null,
      });

      return result;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  public async verify(externalUrl: string): Promise<boolean> {
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      const response = await page.goto(externalUrl, {
        timeout: this.config.timeoutMs,
        waitUntil: 'domcontentloaded',
      });

      return response?.ok() === true;
    } catch {
      // Unreachable is an answer, not an error. A video YouTube is still
      // processing is a legitimate "not yet".
      return false;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Opens a visible browser and waits for a person to sign in to Google.
   *
   * Always headed. Google is stricter than TikTok about automated sign-ins, and
   * the password is typed into Google's own page — it never passes through here.
   */
  public async captureSession(timeoutMs: number): Promise<string> {
    const browser = await this.launch(false).catch((error: unknown) => {
      throw new PublishFailedError(
        'No browser could be opened on the machine running the backend — it may have no display. Capture the session on a machine you can see, or paste a cookie export instead.',
        false,
        { reason: error instanceof Error ? error.message : 'unknown' },
      );
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' });

      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (page.isClosed()) {
          throw new PublishFailedError('The browser was closed before sign-in finished.', false);
        }
        if (hasSignInCookies(await context.cookies(), 'YOUTUBE')) {
          const state = await context.storageState();

          this.logger.info('Captured a YouTube sign-in', {
            source: YouTubePublishService.name,
            cookies: state.cookies.length,
          });

          return JSON.stringify(state);
        }

        await page.waitForTimeout(SIGN_IN_POLL_MS).catch(() => undefined);
      }

      throw new PublishTimeoutError(timeoutMs, 'signing in');
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /** Real Chrome where it exists; the bundled build is the fallback. */
  private async launch(headless: boolean): Promise<Browser> {
    const options = { headless, args: UNDETECTABLE };

    try {
      return await chromium.launch({ ...options, channel: 'chrome' });
    } catch {
      return chromium.launch(options).catch(() => chromium.launch({ headless: true, args: UNDETECTABLE }));
    }
  }

  /**
   * Makes sure the upload dialog is actually open.
   *
   * `/upload` normally lands straight on it, but Studio sometimes answers with
   * the dashboard — after a channel switch, or when it wants to show a notice
   * first. Clicking through is cheap; assuming and then failing on a missing
   * file input is what produced "the page has probably changed".
   */
  private async openUploader(page: Page): Promise<void> {
    // Dismissed first: while it is up, nothing else on the page exists.
    const skip = await this.find(page, SELECTORS.skipInterstitial);

    if (skip !== null) {
      this.logger.info('Dismissed the unsupported-browser notice', {
        source: YouTubePublishService.name,
      });
      await skip.click();
      await page.waitForTimeout(PROBE_MS);
    }

    if ((await this.find(page, SELECTORS.fileInput, PROBE_MS, 'attached')) !== null) return;

    const create = await this.find(page, SELECTORS.createButton);

    if (create === null) return;

    await create.click();

    const upload = await this.find(page, SELECTORS.uploadVideos);
    if (upload !== null) await upload.click();
  }

  private async attach(page: Page, videoPath: string): Promise<void> {
    // Attached, not visible. Studio hides its file input behind a "Select
    // files" button and drives it from JavaScript, so waiting for it to become
    // visible waits for something that never happens — which is exactly how a
    // page that was working reported "the page has probably changed".
    const input = await this.locate(page, SELECTORS.fileInput, 'the file picker', 'attached');
    await input.setInputFiles(videoPath);

    // The title box appears only once Studio has accepted the file, so waiting
    // for it is how "the upload started" is observed.
    await this.locate(page, SELECTORS.title, 'the title box');
  }

  private async describe(page: Page, request: PublishRequest): Promise<void> {
    const wanted = request.title.slice(0, TITLE_LIMIT);
    const title = await this.stage(page, SELECTORS.title, 'the title box');

    await title.scrollIntoViewIfNeeded().catch(() => undefined);
    await title.click();

    // Studio pre-fills the title from the file name — `final.mp4` becomes
    // "final". Selecting all and typing over it is the only reliable clear on
    // these Polymer boxes; `fill` does nothing to them.
    await title
      .evaluate((el) => {
        el.textContent = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })
      .catch(() => undefined);

    await page.keyboard.press('ControlOrMeta+A').catch(() => undefined);
    await page.keyboard.press('Meta+A').catch(() => undefined);
    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
    await title.pressSequentially(wanted, { delay: 15 });

    // Read back. A title box that silently refused the keystrokes leaves the
    // file name published as the title, which is the sort of thing nobody
    // notices until it is on the channel.
    let written = (await title.textContent().catch(() => null))?.trim() ?? '';

    if (!written.startsWith(wanted.slice(0, 10))) {
      await title
        .evaluate((el, val) => {
          el.textContent = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, wanted)
        .catch(() => undefined);

      written = (await title.textContent().catch(() => null))?.trim() ?? '';
    }

    if (!written.startsWith(wanted.slice(0, 10))) {
      throw new PublishFailedError(
        'The title did not take — Studio still shows something else in the box.',
        true,
        { wanted, written },
      );
    }

    const description = await this.find(page, SELECTORS.description, this.config.timeoutMs);

    if (description === null) {
      this.logger.warn('No description box found; publishing without one', {
        source: YouTubePublishService.name,
      });

      return;
    }

    await description.scrollIntoViewIfNeeded().catch(() => undefined);
    await description.click();
    await description
      .evaluate((el) => {
        el.textContent = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })
      .catch(() => undefined);

    // Typed at speed: a description is a paragraph, and a per-character delay
    // meant for a title box would spend a minute on it.
    await description.pressSequentially(
      captionWithTags(request.description, request.hashtags, this.config.maxHashtags),
      { delay: 1 },
    );

    this.logger.info('Filled the details', {
      source: YouTubePublishService.name,
      title: wanted,
    });
  }

  /** The watch link Studio shows beside the upload, or null if it has not yet. */
  private async readLink(page: Page): Promise<string | null> {
    const link = await this.find(page, SELECTORS.shareLink, this.config.timeoutMs);
    const href = link === null ? null : await link.getAttribute('href').catch(() => null);

    if (href === null) {
      this.logger.warn('Studio showed no watch link on the details screen', {
        source: YouTubePublishService.name,
      });
    }

    return href;
  }

  /**
   * Uploads the chosen still as the video's thumbnail.
   *
   * Best-effort, and often simply unavailable: YouTube offers custom
   * thumbnails only to verified channels, so on a new one the input is not
   * there at all. That is worth a line in the log and nothing more — the video
   * still publishes with an auto-generated thumbnail.
   */
  private async setThumbnail(page: Page, coverPath: string | null): Promise<void> {
    if (coverPath === null) return;

    const input = await this.find(page, SELECTORS.thumbnailInput);

    if (input === null) {
      this.logger.warn('No custom thumbnail input; the channel may not be verified yet', {
        source: YouTubePublishService.name,
      });

      return;
    }

    await input.setInputFiles(coverPath);
    this.logger.info('Set the thumbnail from a generated still', {
      source: YouTubePublishService.name,
      coverPath,
    });
  }

  /**
   * Answers the made-for-kids question.
   *
   * Not optional: Studio refuses to advance past the first screen until it is
   * answered, so skipping it does not publish a video with the question blank —
   * it hangs on a screen nobody is watching.
   *
   * Which way it is answered comes from configuration, because it is a legal
   * declaration about the channel's content rather than something to infer from
   * a video.
   */
  private async answerAudience(page: Page): Promise<void> {
    const wanted = this.config.madeForKids ? SELECTORS.forKids : SELECTORS.notForKids;
    const answer = await this.find(page, wanted, this.config.timeoutMs);

    if (answer === null) {
      throw new PublishFailedError(
        'Could not find the made-for-kids question — YouTube Studio will not continue without it.',
        false,
        { madeForKids: this.config.madeForKids },
      );
    }

    await answer.scrollIntoViewIfNeeded().catch(() => undefined);
    await answer.click().catch(async () => {
      await answer.click({ force: true });
    });

    const isChecked = await answer
      .evaluate((el) => el.getAttribute('aria-checked') === 'true' || el.hasAttribute('checked'))
      .catch(() => false);

    if (!isChecked) {
      const radioContainer = answer.locator('#radioContainer, #offRadio, .disc').first();
      if (await radioContainer.isVisible().catch(() => false)) {
        await radioContainer.click({ force: true }).catch(() => undefined);
      }
    }

    this.logger.info('Answered the audience question', {
      source: YouTubePublishService.name,
      madeForKids: this.config.madeForKids,
    });
  }

  /** Clicks through Details → Video elements → Checks → Visibility. */
  private async walkToVisibility(page: Page): Promise<void> {
    for (let step = 0; step < WIZARD_STEPS; step += 1) {
      if (await this.present(page, SELECTORS.public, 1_000)) {
        this.logger.info(`Reached Visibility screen on step ${step}`, {
          source: YouTubePublishService.name,
        });
        return;
      }

      const next = await this.find(page, SELECTORS.next, this.config.timeoutMs);

      if (next === null) {
        this.logger.warn('Could not find Next button during wizard step progression', {
          source: YouTubePublishService.name,
          // Not `step`: that field names a pipeline step, and this is a counter
          // for YouTube's own upload wizard.
          wizardStep: step,
        });
        break;
      }

      await page
        .waitForFunction(
          (el) => {
            if (!el) return false;
            return el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('disabled');
          },
          await next.elementHandle(),
          { timeout: 10_000 },
        )
        .catch(() => undefined);

      await next.scrollIntoViewIfNeeded().catch(() => undefined);
      await next.click().catch(async () => {
        await next.click({ force: true });
      });

      await page.waitForTimeout(1_000);
    }

    const reachedVisibility = await this.present(page, SELECTORS.public, 5_000);
    if (!reachedVisibility) {
      this.logger.warn('Walked through steps but did not reach Visibility screen', {
        source: YouTubePublishService.name,
      });
    }
  }

  private async makePublic(page: Page): Promise<void> {
    const isPublic = await this.find(page, SELECTORS.public, this.config.timeoutMs);

    if (isPublic === null) {
      throw new PublishFailedError(
        'Could not find the Public option — refusing to publish rather than leaving the video private.',
        false,
      );
    }

    await isPublic.scrollIntoViewIfNeeded().catch(() => undefined);
    await isPublic.click().catch(async () => {
      await isPublic.click({ force: true });
    });
  }

  /**
   * Presses Done and reads back the watch link.
   *
   * The link is best-effort for the same reason it is on TikTok: by this point
   * the video is on YouTube, and a link that has not rendered yet must not turn
   * a published video into a failed run.
   */
  private async finish(page: Page, knownLink: string | null): Promise<PublishResult> {
    const done = await this.stage(page, SELECTORS.done, 'the Done button');

    await page
      .waitForFunction(
        (el) => {
          if (!el) return false;
          return el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('disabled');
        },
        await done.elementHandle(),
        { timeout: 10_000 },
      )
      .catch(() => undefined);

    await done.scrollIntoViewIfNeeded().catch(() => undefined);
    await done.click().catch(async () => {
      await done.click({ force: true });
    });

    // Waited on rather than assumed: closing the browser the instant Done is
    // clicked can abandon the request that commits the visibility, and the
    // video stays the private draft it was during the wizard.
    if (!(await this.present(page, SELECTORS.published, LINK_LOOKUP_MS))) {
      this.logger.warn('Pressed Done but saw no confirmation', {
        source: YouTubePublishService.name,
      });
    }

    const href = knownLink ?? (await this.readLink(page));
    const id = href === null ? undefined : VIDEO_ID.exec(href)?.[1];

    if (id === undefined) {
      this.logger.warn('Published to YouTube, but no watch link was shown', {
        source: YouTubePublishService.name,
      });

      return { externalId: null, externalUrl: null };
    }

    return { externalId: id, externalUrl: `${this.config.profileBaseUrl}/shorts/${id}` };
  }

  /**
   * Waits for the wizard to reach a screen, with the whole stage budget.
   *
   * The counterpart of {@link find}: this is for the things that *must* arrive
   * and simply take time, rather than the things that may not exist at all.
   */
  private async stage(page: Page, candidates: readonly string[], what: string): Promise<Locator> {
    const found = await this.find(page, candidates, this.config.timeoutMs);

    if (found !== null) return found;

    throw new PublishFailedError(
      `Waited for ${what} in YouTube Studio and it never arrived.`,
      false,
      { candidates: [...candidates], waitedMs: this.config.timeoutMs },
    );
  }

  /** The first selector that is present, or a typed failure. */
  private async locate(
    page: Page,
    candidates: readonly string[],
    what: string,
    state: 'visible' | 'attached' = 'visible',
  ): Promise<Locator> {
    const found = await this.find(page, candidates, PROBE_MS, state);

    if (found !== null) return found;

    throw new PublishFailedError(
      `Could not find ${what} in YouTube Studio — the page has probably changed.`,
      false,
      { candidates: [...candidates] },
    );
  }

  /** The first selector that is present, or null. */
  private async find(
    page: Page,
    candidates: readonly string[],
    timeoutMs: number = PROBE_MS,
    state: 'visible' | 'attached' = 'visible',
  ): Promise<Locator | null> {
    for (const selector of candidates) {
      const locator = page.locator(selector).first();

      try {
        await locator.waitFor({ state, timeout: timeoutMs });

        return locator;
      } catch {
        // Studio serves more than one layout; a miss here is expected.
      }
    }

    return null;
  }

  /** Whether any of `candidates` shows up, without failing when none does. */
  private async present(
    page: Page,
    candidates: readonly string[],
    timeoutMs: number = PROBE_MS,
  ): Promise<boolean> {
    return (await this.find(page, candidates, timeoutMs)) !== null;
  }
}

