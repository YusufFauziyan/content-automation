import type { UploadDto } from '../dto/upload.dto.js';
import type { ContentRepository } from '../repositories/content.repository.js';
import type { UploadRepository } from '../repositories/upload.repository.js';
import type { WorkflowRepository } from '../repositories/workflow.repository.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { RecordNotFoundError } from '../types/errors/persistence.error.js';
import type { Logger } from '../types/logger.js';
import { UploadStatus, type UploadPlatform } from '../types/upload.js';

/** What a person may say about a publish that the system did not perform. */
export interface RecordUploadRequest {
  readonly workflowRunId: string;
  readonly platform: UploadPlatform;
  readonly externalUrl?: string;
  readonly status?: UploadStatus;
}

/** What a person may change about a recorded publish. */
export interface EditUploadRequest {
  readonly externalUrl?: string | null;
  readonly status?: UploadStatus;
}

/** The video id inside a platform URL, when there is one to read. */
const EXTERNAL_ID = /\/(?:video|shorts|watch\?v=)\/?([\w-]{6,})/;

/**
 * Reads the platform's own id out of a URL, or null when it is not in there.
 *
 * Not required for anything to work — the URL is what a person clicks and what
 * survives. The id is recorded when it can be had because it is the stable
 * handle if the URL format ever changes underneath it.
 */
export const toExternalId = (url: string): string | null => EXTERNAL_ID.exec(url)?.[1] ?? null;

/**
 * Correcting the publishing record by hand.
 *
 * Publishing is the one stage with a step outside the system: a person can post
 * the video themselves, and the browser can post it and fail to read back the
 * link. Both leave the record less true than the world. This is how it is made
 * true again — the only place where a publish may be asserted rather than
 * observed.
 *
 * Deliberately separate from {@link ReadUploadsUseCase}: reading the history is
 * something the dashboard does constantly, and writing to it is something a
 * person does rarely and deliberately.
 */
export class ManageUploadsUseCase {
  constructor(
    private readonly uploadRepository: UploadRepository,
    private readonly workflowRepository: WorkflowRepository,
    private readonly contentRepository: ContentRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Records that a run's video was published, whoever published it.
   *
   * Keyed on the run rather than the content because a run is what a person is
   * looking at when they decide to say this.
   *
   * @throws {RecordNotFoundError} When the run has produced no content yet.
   */
  public async record(input: RecordUploadRequest): Promise<UploadDto> {
    const run = await this.workflowRepository.findRunById(input.workflowRunId);
    const contentId = run?.contentId ?? null;

    if (contentId === null) {
      throw new RecordNotFoundError('workflow run with content', input.workflowRunId);
    }

    const content = await this.contentRepository.findById(contentId);

    if (content === null) {
      throw new RecordNotFoundError('content', contentId);
    }

    const url = input.externalUrl?.trim();
    const now = new Date();

    // Verified by default: a person saying "I posted this" has seen it live,
    // which is exactly what verification is for. The browser cannot claim that
    // for itself, but a person can.
    const status = input.status ?? UploadStatus.Verified;

    const known = url !== undefined && url !== '';
    const externalId = known ? toExternalId(url) : null;

    const upload = await this.uploadRepository.upsert({
      contentId: content.id,
      platform: input.platform,
      status,
      ...(known ? { externalUrl: url } : {}),
      ...(externalId === null ? {} : { externalId }),
      uploadedAt: now,
      ...(status === UploadStatus.Verified ? { verifiedAt: now } : {}),
    });

    this.logger.info('Recorded a publish by hand', {
      source: ManageUploadsUseCase.name,
      workflowRunId: input.workflowRunId,
      platform: input.platform,
      status,
      hasUrl: url !== undefined && url !== '',
    });

    return upload;
  }

  /**
   * Changes what is recorded about one publish.
   *
   * @throws {AgentOutputInvalidError} When the change would say nothing.
   * @throws {RecordNotFoundError} When the upload does not exist.
   */
  public async edit(id: string, input: EditUploadRequest): Promise<UploadDto> {
    if (input.externalUrl === undefined && input.status === undefined) {
      throw new AgentOutputInvalidError(
        ManageUploadsUseCase.name,
        'Send a URL, a status, or both.',
        { uploadId: id },
      );
    }

    const existing = await this.uploadRepository.findById(id);

    if (existing === null) {
      throw new RecordNotFoundError('upload', id);
    }

    const url = input.externalUrl?.trim();
    const status = input.status ?? existing.status;

    const upload = await this.uploadRepository.updateResult(id, {
      status,
      ...(input.externalUrl === undefined
        ? {}
        : {
            externalUrl: url === '' ? '' : (url ?? ''),
            externalId: url === undefined || url === '' ? '' : (toExternalId(url) ?? ''),
          }),
      // Stamped when a person moves a row to verified and it was not before:
      // the timestamp should say when somebody confirmed it, not stay empty
      // because nothing automated did.
      ...(status === UploadStatus.Verified && existing.verifiedAt === null
        ? { verifiedAt: new Date() }
        : {}),
    });

    this.logger.info('Edited a publish record', {
      source: ManageUploadsUseCase.name,
      uploadId: id,
      status,
    });

    return upload;
  }

  /** Removes publish records. The video on the platform is untouched. */
  public async remove(ids: readonly string[]): Promise<number> {
    const deleted = await this.uploadRepository.deleteMany(ids);

    this.logger.info('Removed publish records', {
      source: ManageUploadsUseCase.name,
      deleted,
    });

    return deleted;
  }
}
