import {
  CredentialAuthMethod,
  CredentialPlatform,
  type CredentialDto,
} from '../dto/credential.dto.js';
import type { UploadDto, UploadRequestDto } from '../dto/upload.dto.js';
import type { CredentialRepository } from '../repositories/credential.repository.js';
import type { UploadRepository } from '../repositories/upload.repository.js';
import type { BrowserSession, PlaywrightService } from '../services/playwright.service.js';
import type { SecretBox } from '../services/secret-box.service.js';
import type { Agent } from '../types/agent.js';
import { isApplicationError } from '../types/errors/application.error.js';
import {
  CredentialMissingError,
  PublishFailedError,
  PublishSessionExpiredError,
} from '../types/errors/publish.error.js';
import type { Logger } from '../types/logger.js';
import { fail, ok, type Result } from '../types/result.js';
import { UploadPlatform, UploadStatus } from '../types/upload.js';

/**
 * Publishes the video and confirms it is live.
 *
 * Purpose
 * - Upload the rendered video, then verify that the published URL is reachable
 *   before reporting success.
 *
 * Input
 * - {@link UploadRequestDto}
 *
 * Output
 * - {@link UploadDto} — status `VERIFIED` and the public URL.
 *
 * Dependencies
 * - `PlaywrightService` — performs and verifies the upload.
 * - `CredentialRepository` + `SecretBox` — supply the account to publish as.
 * - `UploadRepository` — records the attempt and its result.
 *
 * Verification is not optional: the Cleanup Agent deletes the only copy of the
 * video, so an unverified upload would lose the work permanently.
 */
export type UploadAgent = Agent<UploadRequestDto, UploadDto>;

/** The field a browser session is stored under. Mirrors `SESSION_FIELD`. */
const SESSION_FIELD = 'storageState';

/**
 * Which account a publish target needs.
 *
 * The two enums share their string values today and must not inherit that
 * coincidence: a destination and a stored account are different ideas, and one
 * being renamed should break this line rather than something far away.
 */
export const TO_CREDENTIAL: Readonly<Record<UploadPlatform, CredentialPlatform>> = {
  [UploadPlatform.TikTok]: CredentialPlatform.TikTok,
  [UploadPlatform.YouTube]: CredentialPlatform.YouTube,
};

/**
 * Publishes through a real browser, as a signed-in person would.
 *
 * The credential work lives here rather than in the service because a service
 * integrates one external system and knows nothing of accounts, while an agent
 * may read repositories. This decides *who* publishes; Playwright knows only
 * *how*.
 *
 * Every outcome is written to `uploads` as it happens — `UPLOADING` before the
 * browser opens, then `UPLOADED`, then `VERIFIED`. A process killed mid-publish
 * therefore leaves a row saying how far it got, which is the difference between
 * a recoverable run and a video nobody can account for.
 */
export class BrowserUploadAgent implements UploadAgent {
  public readonly name = 'BrowserUploadAgent';

  constructor(
    /**
     * One publisher per destination, or null where this installation has none.
     *
     * A map rather than a single service: TikTok's uploader is one page and
     * YouTube Studio is a four-screen wizard, and the only thing they share is
     * this contract.
     */
    private readonly publishers: Readonly<Partial<Record<UploadPlatform, PlaywrightService>>>,
    private readonly credentialRepository: CredentialRepository,
    private readonly uploadRepository: UploadRepository,
    private readonly secretBox: SecretBox,
    private readonly logger: Logger,
  ) {}

  public async execute(input: UploadRequestDto): Promise<Result<UploadDto>> {
    // Opened rather than created: a destination has one row, and this may well
    // be the second time this video is being sent there.
    const attempt = await this.uploadRepository.open({
      contentId: input.contentId,
      platform: input.platform,
      status: UploadStatus.Pending,
    });

    const publisher = this.publishers[input.platform];

    try {
      if (publisher === undefined) {
        throw new CredentialMissingError(input.platform, {
          reason: 'no publisher is configured for this platform',
        });
      }

      const account = await this.account(input.platform);
      const session = await this.session(input.platform, account);

      await this.uploadRepository.updateResult(attempt.id, { status: UploadStatus.Uploading });

      const published = await publisher.publish({
        videoPath: input.video.absolutePath,
        coverPath: input.video.coverPath,
        title: input.title,
        description: input.description,
        hashtags: input.hashtags,
        session,
      });

      // Written the moment the platform confirmed the post, before anything
      // that could still go wrong. A row saying UPLOADED with no link is the
      // truth; a run reported as failed with the video already live is not.
      const uploaded = await this.uploadRepository.updateResult(attempt.id, {
        status: UploadStatus.Uploaded,
        ...(published.externalId === null ? {} : { externalId: published.externalId }),
        ...(published.externalUrl === null ? {} : { externalUrl: published.externalUrl }),
        uploadedAt: new Date(),
      });

      await this.credentialRepository.markUsed(account.id, new Date());

      return await this.confirm(publisher, uploaded, published.externalUrl);
    } catch (error) {
      await this.uploadRepository.updateResult(attempt.id, { status: UploadStatus.Failed });

      if (isApplicationError(error)) {
        this.logger.error('Publishing failed', error, {
          source: this.name,
          contentId: input.contentId,
          platform: input.platform,
        });

        return fail(error);
      }

      // An unrecognised throw out of a browser is almost always transient — a
      // socket, a crashed page — so it is worth one more attempt rather than
      // failing the run outright.
      return fail(
        new PublishFailedError(
          error instanceof Error ? error.message : 'The browser failed unexpectedly.',
          true,
          { contentId: input.contentId },
        ),
      );
    }
  }

  /** The account to publish as, or a failure naming what is missing. */
  private async account(platform: UploadPlatform): Promise<CredentialDto> {
    const account = await this.credentialRepository.findUsable(
      TO_CREDENTIAL[platform],
      CredentialAuthMethod.Browser,
    );

    if (account === null) {
      throw new CredentialMissingError(platform, {
        authMethod: CredentialAuthMethod.Browser,
      });
    }

    return account;
  }

  /**
   * Opens the stored session.
   *
   * The handle comes from the credential's label, which is what an operator
   * typed when connecting the account — so a mistyped handle surfaces as a
   * profile that cannot be read, rather than as a video published somewhere
   * nobody looks.
   */
  private async session(
    platform: UploadPlatform,
    account: CredentialDto,
  ): Promise<BrowserSession> {
    const stored = await this.credentialRepository.findSealed(account.id);

    if (stored === null) {
      throw new CredentialMissingError(platform, { credentialId: account.id });
    }

    const fields: unknown = JSON.parse(this.secretBox.open(stored.sealed));
    const storageState =
      typeof fields === 'object' && fields !== null
        ? (fields as Record<string, unknown>)[SESSION_FIELD]
        : undefined;

    if (typeof storageState !== 'string' || storageState.trim() === '') {
      throw new PublishSessionExpiredError(platform, {
        reason: 'the stored credential holds no session',
      });
    }

    return { storageState, handle: account.label };
  }

  /**
   * Checks the published video is really there before calling the run done.
   *
   * Two ways to end at `UPLOADED` rather than `VERIFIED`, and neither is a
   * failure: the platform did not hand back a link yet, or the link is not
   * reachable yet. In both cases the video exists and the run is done; the row
   * says so, and a person can complete it from the Uploads page. Reporting a
   * failure instead would invite a second publish of something already live.
   *
   * `VERIFIED` keeps its meaning either way, which is what matters: it is the
   * only status that will ever permit the render to be deleted.
   */
  private async confirm(
    publisher: PlaywrightService,
    uploaded: UploadDto,
    externalUrl: string | null,
  ): Promise<Result<UploadDto>> {
    if (externalUrl === null) {
      this.logger.warn('Published, but with no link to record — add it from Uploads', {
        source: this.name,
        contentId: uploaded.contentId,
      });

      return ok(uploaded);
    }

    if (!(await publisher.verify(externalUrl))) {
      this.logger.warn('Published, but the video is not reachable yet', {
        source: this.name,
        externalUrl,
      });

      return ok(uploaded);
    }

    const verified = await this.uploadRepository.updateResult(uploaded.id, {
      status: UploadStatus.Verified,
      verifiedAt: new Date(),
    });

    this.logger.info('Published and verified', {
      source: this.name,
      contentId: verified.contentId,
      externalUrl,
    });

    return ok(verified);
  }
}
