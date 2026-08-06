import type { UploadHistoryDto } from '../dto/upload.dto.js';
import type { UploadRepository } from '../repositories/upload.repository.js';
import type { Logger } from '../types/logger.js';

/** How many attempts a request returns when it does not say. */
const DEFAULT_LIMIT = 50;

/** Ceiling on one request, so a typo cannot ask for the whole table. */
const MAX_LIMIT = 500;

/**
 * Reading what has been published.
 *
 * The rendered video is deleted once an upload is verified, so `external_url`
 * is the only durable trace that a run ever produced anything. This is what
 * makes that trace readable — which is why it lists failures too: a history
 * showing only successes would quietly hide the week publishing stopped
 * working.
 */
export class ReadUploadsUseCase {
  constructor(
    private readonly uploadRepository: UploadRepository,
    private readonly logger: Logger,
  ) {}

  public async history(limit = DEFAULT_LIMIT): Promise<readonly UploadHistoryDto[]> {
    const capped = Math.min(Math.max(1, limit), MAX_LIMIT);
    const uploads = await this.uploadRepository.findRecent(capped);

    this.logger.debug('Read the upload history', {
      source: ReadUploadsUseCase.name,
      returned: uploads.length,
    });

    return uploads;
  }
}
