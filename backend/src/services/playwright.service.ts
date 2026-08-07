import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';

import type { BrowserPublishConfig } from '../config/app.config.js';
import type { SessionCapturer } from '../dto/credential.dto.js';
import {
  PublishFailedError,
  PublishSessionExpiredError,
  PublishTimeoutError,
} from '../types/errors/publish.error.js';
import type { Logger } from '../types/logger.js';
import { hasSignInCookies } from '../utils/credential/session-import.js';

/**
 * A captured sign-in, as replayed into a fresh browser.
 *
 * `storageState` is Playwright's own format — cookies plus local storage —
 * because TikTok keeps part of its signed-in state outside cookies, and a
 * cookies-only replay is signed in until the moment it is not.
 *
 * The handle travels with it: the published video's URL is discovered from the
 * account's own profile page, and there is no way to ask a session who it is
 * without loading a page that might itself be the thing that failed.
 */
export interface BrowserSession {
  /** The JSON written by the login capture script. */
  readonly storageState: string;
  /** The account handle, with or without its leading `@`. */
  readonly handle: string;
}

/** Everything the browser automation needs to publish one video. */
export interface PublishRequest {
  readonly videoPath: string;
  /**
   * A still to use as the cover, or null to let the platform choose.
   *
   * Worth setting whenever there is one. Left alone, every platform grabs the
   * frame at 00:00 — which in this pipeline is the opening shot with the first
   * caption burned across it, before the camera has begun to move.
   */
  readonly coverPath: string | null;
  /** One line. YouTube's title field, and the front of TikTok's caption. */
  readonly title: string;
  /**
   * The longer text, for platforms with somewhere to put it.
   *
   * Separate from the title because the two are different writing: a title is
   * the thing somebody scrolls past, a description is what they read once they
   * have stopped. Folding them together, as this did, meant YouTube's
   * description was the title again.
   */
  readonly description: string;
  readonly hashtags: readonly string[];
  readonly session: BrowserSession;
}

/**
 * What the platform reported once the upload finished.
 *
 * The identifiers are nullable because the post and the link are two different
 * facts. TikTok confirms the post immediately but takes a while to show it on
 * the profile, which is the only place its URL can be read — and a video that
 * is live with an unknown URL is a success with a gap, not a failure. The gap
 * is fillable by hand later; an undone success is not.
 */
export interface PublishResult {
  readonly externalId: string | null;
  readonly externalUrl: string | null;
}

/**
 * Contract for browser-driven publishing.
 *
 * External system: Playwright driving the TikTok web application.
 *
 * The service performs the interaction. Deciding *whether* to publish, and
 * whether the published result is acceptable, belongs to the Upload and QA
 * agents.
 */
export interface PlaywrightService extends SessionCapturer {
  /**
   * Publishes one video.
   *
   * @throws {PublishSessionExpiredError} When the saved session is signed out.
   * @throws {PublishTimeoutError} When a stage exceeds the configured budget.
   * @throws {PublishFailedError} When the page refused or never got there.
   */
  publish(request: PublishRequest): Promise<PublishResult>;

  /**
   * Confirms that a published video is reachable.
   *
   * Media may only be deleted after this returns `true`
   * (ARCHITECTURE.md "Temporary Media Lifecycle").
   */
  verify(externalUrl: string): Promise<boolean>;
}

/**
 * The parts of TikTok's page this depends on.
 *
 * This is the fragile surface, and naming it in one place is the point: when
 * publishing breaks after a TikTok release, the change belongs here and
 * nowhere else.
 *
 * Each entry is a list because TikTok serves more than one version of its
 * uploader — they are tried in order and the first present wins, so a layout
 * change degrades to "the other selector matched" rather than to a failure.
 */
const SELECTORS = {
  fileInput: ['input[type="file"]'],
  caption: [
    '.public-DraftEditor-content',
    '[data-e2e="caption-input"]',
    'div[contenteditable="true"]',
  ],
  post: [
    'button[data-e2e="post_video_button"]',
    'button:has-text("Post")',
    'div[role="button"]:has-text("Post")',
  ],
  /** Opens the "who can watch this video" chooser. */
  visibility: [
    '[data-e2e="post_video_privacy"]',
    'div[role="combobox"]:near(:text("Who can watch"))',
    'div:has-text("Who can watch this video") [role="combobox"]',
  ],
  /** The public option, in the languages TikTok serves the uploader in. */
  everyone: [
    '[role="option"]:has-text("Everyone")',
    'li:has-text("Everyone")',
    'div[role="option"]:has-text("Public")',
  ],
  /** Opens the cover editor. */
  editCover: [
    '[data-e2e="select_cover"]',
    'div:has-text("Cover") button:has-text("Edit")',
    'button:has-text("Edit cover")',
  ],
  /** The cover editor's own upload tab and its file input. */
  uploadCoverTab: ['div[role="tab"]:has-text("Upload cover")', 'text=/upload cover/i'],
  coverInput: ['input[type="file"][accept*="image"]'],
  /** Commits the cover editor. */
  confirmCover: ['button:has-text("Confirm")', 'button:has-text("Done")', 'button:has-text("Save")'],
  posted: [
    'text=/your video is being uploaded/i',
    'text=/manage your posts/i',
    '[data-e2e="upload-success"]',
  ],
  /** Present only when the session is no longer signed in. */
  signedOut: ['text=/log in to tiktok/i', '[data-e2e="login-button"]'],
} as const;

/** How often to re-read the address bar while waiting for a sign-in. */
const SIGN_IN_POLL_MS = 1_000;

/**
 * What makes an automated Chrome look like an ordinary one.
 *
 * TikTok refuses to complete a sign-in in a browser it can tell is driven by a
 * tool — the QR code scans, and then nothing happens. This is not about hiding
 * from TikTok in general: the account is the operator's own, and the same
 * person signing in by hand two minutes earlier is allowed. It is about the
 * automation flag being the only difference between the two.
 */
const UNDETECTABLE = [
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
];

/** How long to wait for a selector that is merely probable, not required. */
const PROBE_MS = 2_000;

/**
 * How long to hunt for the published video's link before giving up on it.
 *
 * Short on purpose. The video is already live by then; every extra second is
 * spent holding a browser open for a nicety, and the whole stage budget spent
 * here is what left runs hanging with the post already made.
 */
const LINK_LOOKUP_MS = 15_000;

/** How often to re-check a button that starts disabled. */
const POLL_MS = 500;

/** TikTok video URLs end in the numeric id: `/@handle/video/7123…`. */
const VIDEO_ID = /\/video\/(\d+)/;

/** Strips leading `@`s so a handle can be joined onto a base URL exactly once. */
const bareHandle = (handle: string): string => handle.replace(/^@+/, '');

/**
 * The caption as the platform will store it.
 *
 * Hashtags are appended rather than expected inside the caption, so the script
 * agent and the tagging stay separable — and duplicates are dropped, because a
 * tag written twice costs characters in a limited field and gains nothing.
 *
 * Trimmed to `limit` **after** de-duplicating, so a repeated tag never uses up
 * one of the places. The first ones are kept because the writer puts the tags
 * closest to the subject first; a random few would be a worse set than the
 * front of an ordered one.
 */
export const captionWithTags = (
  caption: string,
  hashtags: readonly string[],
  limit: number,
): string => {
  const tags = hashtags
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, Math.max(0, limit));

  return [caption.trim(), ...tags].filter((part) => part !== '').join(' ');
};

/**
 * Publishes by driving a real browser.
 *
 * Every run starts from a fresh context built from the stored session, and the
 * context is discarded afterwards. Nothing is written back: a session TikTok
 * rotated mid-run would otherwise be half-saved, and a half-saved session is
 * worse than a stale one because it looks current.
 *
 * The browser is launched per publish rather than kept warm. Uploads happen a
 * few times a day at most, so a resident browser would spend its life idle
 * holding a signed-in session open — cost with no speed to show for it.
 */
export class PlaywrightPublishService implements PlaywrightService {
  constructor(
    private readonly config: BrowserPublishConfig,
    private readonly logger: Logger,
  ) {}

  public async publish(request: PublishRequest): Promise<PublishResult> {
    const browser = await chromium
      .launch({ headless: this.config.headless, args: UNDETECTABLE, channel: 'chrome' })
      .catch(() => chromium.launch({ headless: this.config.headless, args: UNDETECTABLE }))
      .catch(() => chromium.launch({ headless: true, args: UNDETECTABLE }));

    try {
      return await this.publishWith(browser, request);
    } finally {
      // Closing must not mask why publishing failed: a close that throws while
      // an upload error propagates would replace a useful error with a useless
      // one.
      await browser.close().catch(() => undefined);
    }
  }

  public async verify(externalUrl: string): Promise<boolean> {
    // Always headless, and always signed out: the question is whether the video
    // is public, not whether its owner can see it.
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      const response = await page.goto(externalUrl, {
        timeout: this.config.timeoutMs,
        waitUntil: 'domcontentloaded',
      });
      const reachable = response?.ok() === true;

      this.logger.info('Checked a published video', {
        source: PlaywrightPublishService.name,
        externalUrl,
        reachable,
      });

      return reachable;
    } catch {
      // Unreachable is an answer, not an error: the caller asked a yes/no
      // question, and a network failure is a "no, not yet".
      return false;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * Opens a visible browser and waits for a person to sign in.
   *
   * Always headed, whatever `TIKTOK_HEADLESS` says: the entire point is that
   * somebody can see the window and type into it. A password is typed into
   * TikTok's own page in a browser this process merely started — it is never
   * read, relayed or stored, and only what TikTok hands back afterwards is
   * kept.
   */
  public async captureSession(timeoutMs: number): Promise<string> {
    const browser = await this.launchForSignIn().catch((error: unknown) => {
      // The usual cause on a server is no display at all. Said plainly, because
      // the answer is "do this somewhere else", not "try again".
      throw new PublishFailedError(
        'No browser could be opened on the machine running the backend — it may have no display. Capture the session on a machine you can see, or paste a session file instead.',
        false,
        { reason: error instanceof Error ? error.message : 'unknown' },
      );
    });

    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' });

      await this.waitForSignIn(context, page, timeoutMs);

      const state = await context.storageState();

      this.logger.info('Captured a sign-in', {
        source: PlaywrightPublishService.name,
        cookies: state.cookies.length,
      });

      return JSON.stringify(state);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /**
   * A browser a person can actually sign in with.
   *
   * Prefers real Chrome over the bundled Chromium: TikTok treats the two
   * differently, and the one already on the machine is the one its checks
   * expect. Falls back when Chrome is not installed, because a browser that
   * might be refused still beats no browser at all.
   */
  private async launchForSignIn(): Promise<Browser> {
    const options = { headless: false, args: UNDETECTABLE };

    try {
      return await chromium.launch({ ...options, channel: 'chrome' });
    } catch {
      this.logger.warn('Signing in with bundled Chromium; Chrome was not available', {
        source: PlaywrightPublishService.name,
      });

      try {
        return await chromium.launch(options);
      } catch (error) {
        this.logger.warn('Headful browser launch failed, falling back to headless browser', {
          source: PlaywrightPublishService.name,
          error: error instanceof Error ? error.message : String(error),
        });

        return await chromium.launch({ ...options, headless: true });
      }
    }
  }

  /** Waits until the address bar says signed in, the window closes, or time runs out. */
  private async waitForSignIn(
    context: BrowserContext,
    page: Page,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new PublishFailedError('The browser was closed before sign-in finished.', false);
      }
      if (hasSignInCookies(await context.cookies(), 'TIKTOK')) return;

      await page.waitForTimeout(SIGN_IN_POLL_MS).catch(() => undefined);
    }

    throw new PublishTimeoutError(timeoutMs, 'signing in');
  }

  /** The whole interaction, with the browser's lifetime owned by the caller. */
  private async publishWith(browser: Browser, request: PublishRequest): Promise<PublishResult> {
    const context = await browser.newContext({
      storageState: parseSession(request.session.storageState),
    });
    context.setDefaultTimeout(this.config.timeoutMs);

    const page = await context.newPage();
    await this.openUploader(page);
    await this.attach(page, request.videoPath);
    // TikTok has one field, and it is short. The title carries it; the longer
    // description would be truncated into nonsense.
    await this.writeCaption(
      page,
      captionWithTags(request.title, request.hashtags, this.config.maxHashtags),
    );
    await this.setCover(page, request.coverPath);
    await this.submit(page);

    // The post is confirmed by here. Everything after is about finding its
    // link, and none of it may undo that.
    const result = await this.findPublished(context, request.session.handle);

    this.logger.info('Published a video', {
      source: PlaywrightPublishService.name,
      handle: request.session.handle,
      externalId: result.externalId,
      linkKnown: result.externalUrl !== null,
    });

    return result;
  }

  /** Loads the uploader, failing distinctly when the session is signed out. */
  private async openUploader(page: Page): Promise<void> {
    await page.goto(this.config.uploadUrl, { waitUntil: 'domcontentloaded' });

    if (await this.present(page, SELECTORS.signedOut)) {
      throw new PublishSessionExpiredError('TikTok', { uploadUrl: this.config.uploadUrl });
    }
  }

  private async attach(page: Page, videoPath: string): Promise<void> {
    const input = await this.locate(page, SELECTORS.fileInput, 'the file picker');
    await input.setInputFiles(videoPath);

    // The caption box exists only once TikTok has accepted the file and begun
    // processing it, so waiting for it is how "the upload started" is observed.
    // There is no progress event to listen to.
    await this.locate(page, SELECTORS.caption, 'the caption box');
  }

  private async writeCaption(page: Page, caption: string): Promise<void> {
    const box = await this.locate(page, SELECTORS.caption, 'the caption box');
    await box.click();

    // TikTok pre-fills the caption with the file name. Selecting all and typing
    // over it is the only reliable clear: the editor is a Draft.js surface that
    // ignores `fill`.
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await box.pressSequentially(caption, { delay: 20 });
  }

  /**
   * Sets the audience to everyone.
   *
   * TikTok remembers whatever was chosen last and starts new accounts private,
   * so a published video is not public unless something says so. Not fatal when
   * the control cannot be found: the default is usually already public, and
   * failing a finished render over a chooser that moved would cost more than it
   * saves. It is logged either way, so "why is nobody seeing these" has an
   * answer in the log rather than a guess.
   */
  private async setPublic(page: Page): Promise<void> {
    const chooser = await this.find(page, SELECTORS.visibility);

    if (chooser === null) {
      this.logger.warn('Could not find the audience chooser; posting with whatever TikTok defaults to', {
        source: PlaywrightPublishService.name,
      });

      return;
    }

    await chooser.click();

    const everyone = await this.find(page, SELECTORS.everyone);

    if (everyone === null) {
      this.logger.warn('Found the audience chooser but not the public option', {
        source: PlaywrightPublishService.name,
      });

      return;
    }

    await everyone.click();
    this.logger.info('Set the audience to everyone', {
      source: PlaywrightPublishService.name,
    });
  }

  /**
   * Replaces the automatic cover with the chosen still.
   *
   * Best-effort throughout. The cover editor is the least stable part of the
   * uploader and the most cosmetic: a video published with the platform's own
   * cover is still published, and failing a finished render over a thumbnail
   * would be the wrong trade. Every give-up is logged with what it could not
   * find.
   */
  private async setCover(page: Page, coverPath: string | null): Promise<void> {
    if (coverPath === null) return;

    const editor = await this.find(page, SELECTORS.editCover);

    if (editor === null) {
      this.logger.warn('No cover editor found; TikTok will pick its own frame', {
        source: PlaywrightPublishService.name,
      });

      return;
    }

    await editor.click();

    // The editor opens on the frame picker; the upload tab is a click away and
    // is the only path that accepts a file rather than a timestamp.
    const tab = await this.find(page, SELECTORS.uploadCoverTab);
    if (tab !== null) await tab.click();

    const input = await this.find(page, SELECTORS.coverInput);

    if (input === null) {
      this.logger.warn('Cover editor opened but offered nowhere to upload one', {
        source: PlaywrightPublishService.name,
      });

      return;
    }

    await input.setInputFiles(coverPath);

    const confirm = await this.find(page, SELECTORS.confirmCover);
    if (confirm !== null) await confirm.click();

    this.logger.info('Set the cover from a generated still', {
      source: PlaywrightPublishService.name,
      coverPath,
    });
  }

  private async submit(page: Page): Promise<void> {
    await this.setPublic(page);

    const post = await this.locate(page, SELECTORS.post, 'the Post button');
    await post.waitFor({ state: 'visible' });
    await this.settle(page, post);
    await post.click();

    if (!(await this.present(page, SELECTORS.posted, this.config.timeoutMs))) {
      throw new PublishFailedError('TikTok never confirmed the post.', true, {
        uploadUrl: this.config.uploadUrl,
      });
    }
  }

  /**
   * Waits for the Post button to become enabled, within the stage budget.
   *
   * The button is disabled until the upload finishes processing. Waiting on its
   * own state is more honest than sleeping for a guessed number of seconds: a
   * long video simply takes longer, and a guess is wrong in both directions.
   */
  private async settle(page: Page, post: Locator): Promise<void> {
    const deadline = Date.now() + this.config.timeoutMs;

    while (Date.now() < deadline) {
      if (await post.isEnabled()) return;
      await page.waitForTimeout(POLL_MS);
    }

    throw new PublishTimeoutError(this.config.timeoutMs, 'processing the video');
  }

  /**
   * Finds the video that was just posted, by reading the account's profile.
   *
   * TikTok hands back no id when a post is submitted, and the page it lands on
   * is not always the video's. The newest item on the profile is — which is
   * also why publishing is one video at a time.
   *
   * Best-effort, and deliberately so: by the time this runs the video is
   * already on TikTok. A profile that has not caught up yet, or that renders
   * its grid differently this month, must not turn a published video into a
   * failed run. It returns nulls and says so, and the URL can be filled in by
   * hand afterwards.
   */
  private async findPublished(context: BrowserContext, handle: string): Promise<PublishResult> {
    const profileUrl = `${this.config.profileBaseUrl}/@${bareHandle(handle)}`;
    const unknown: PublishResult = { externalId: null, externalUrl: null };

    try {
      const page = await context.newPage();
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });

      const href = await page
        .locator('a[href*="/video/"]')
        .first()
        .getAttribute('href', { timeout: LINK_LOOKUP_MS })
        .catch(() => null);
      const id = href === null ? undefined : VIDEO_ID.exec(href)?.[1];

      if (href === null || id === undefined) {
        this.logger.warn('Published, but the profile did not show the video yet', {
          source: PlaywrightPublishService.name,
          profileUrl,
        });

        return unknown;
      }

      return {
        externalId: id,
        externalUrl: href.startsWith('http') ? href : `${this.config.profileBaseUrl}${href}`,
      };
    } catch {
      this.logger.warn('Published, but the profile could not be read for the link', {
        source: PlaywrightPublishService.name,
        profileUrl,
      });

      return unknown;
    }
  }

  /**
   * The first selector in `candidates` that is present, or null.
   *
   * The tolerant sibling of {@link locate}: for controls whose absence is worth
   * reporting but not worth failing a finished render over.
   */
  private async find(page: Page, candidates: readonly string[]): Promise<Locator | null> {
    for (const selector of candidates) {
      const locator = page.locator(selector).first();

      try {
        await locator.waitFor({ state: 'visible', timeout: PROBE_MS });

        return locator;
      } catch {
        // Absent is the common case for a probe; keep looking.
      }
    }

    return null;
  }

  /** The first selector in `candidates` that is present, or a typed failure. */
  private async locate(page: Page, candidates: readonly string[], what: string): Promise<Locator> {
    for (const selector of candidates) {
      const locator = page.locator(selector).first();

      try {
        await locator.waitFor({ state: 'attached', timeout: PROBE_MS });

        return locator;
      } catch {
        // Not this one. TikTok serves several versions of the uploader, so a
        // miss here is expected rather than exceptional.
      }
    }

    // Not retryable: a page that has changed shape will have changed shape
    // again in ten seconds, and the fix is a release, not another attempt.
    throw new PublishFailedError(
      `Could not find ${what} on the TikTok uploader — the page has probably changed.`,
      false,
      { candidates: [...candidates] },
    );
  }

  /** Whether any of `candidates` shows up, without failing when none does. */
  private async present(
    page: Page,
    candidates: readonly string[],
    timeoutMs: number = PROBE_MS,
  ): Promise<boolean> {
    for (const selector of candidates) {
      try {
        await page.locator(selector).first().waitFor({ state: 'visible', timeout: timeoutMs });

        return true;
      } catch {
        // Absent is the common case for a probe; keep looking.
      }
    }

    return false;
  }
}

/** Playwright's own storage-state shape, taken from the call that consumes it. */
type StorageState = NonNullable<NonNullable<Parameters<Browser['newContext']>[0]>['storageState']>;

/**
 * The stored session as Playwright wants it, or a failure that says so.
 *
 * Reported as an expired session rather than a parse error because that is what
 * it means to an operator: whatever went wrong, the answer is to capture the
 * session again.
 */
const parseSession = (storageState: string): StorageState => {
  try {
    return JSON.parse(storageState) as StorageState;
  } catch {
    throw new PublishSessionExpiredError('TikTok', {
      reason: 'the stored session is not readable JSON',
    });
  }
};
