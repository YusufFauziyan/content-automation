import {
  CaptureStatus,
  CredentialAuthMethod,
  type CaptureStateDto,
  type CredentialPlatform,
  type SessionCapturer,
} from '../dto/credential.dto.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import { isApplicationError } from '../types/errors/application.error.js';
import type { Logger } from '../types/logger.js';
import type { ManageCredentialsUseCase } from './manage-credentials.usecase.js';
import { SESSION_FIELD } from './manage-credentials.usecase.js';

/**
 * How long a finished capture stays readable before it is forgotten.
 *
 * Long enough for a browser tab that was in the background to poll once more
 * and see the result; short enough that the map does not grow all day.
 */
const KEEP_RESULT_MS = 60_000;

/**
 * Signing in to a platform by opening a browser, from the editor.
 *
 * The alternative — `pnpm tiktok:login`, then copy a file into a form — works,
 * but it asks somebody to move a live credential through their clipboard. Here
 * the session never leaves the process: the browser hands it to the capturer,
 * the capturer hands it to the credential use case, and that seals it.
 *
 * State is held in memory on purpose. A capture is one open window in one
 * process; a row in a table describing a window that closed hours ago would
 * only be believed.
 */
export class CaptureSessionUseCase {
  private readonly captures = new Map<string, CaptureStateDto>();

  /** The capture currently holding a browser open, if any. */
  private running: string | null = null;

  constructor(
    /** One capturer per platform that can be signed in to from here. */
    private readonly capturers: Readonly<Partial<Record<CredentialPlatform, SessionCapturer>>>,
    private readonly manageCredentialsUseCase: ManageCredentialsUseCase,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {}

  /**
   * Opens a browser and starts waiting for someone to sign in.
   *
   * Returns as soon as the browser is asked for, not when it is finished with:
   * signing in takes as long as finding a phone, and an HTTP request held open
   * that long is a request that times out somewhere in between.
   *
   * @throws {AgentOutputInvalidError} When a capture is already in progress.
   */
  public start(input: { platform: CredentialPlatform; label: string }): CaptureStateDto {
    if (this.running !== null) {
      throw new AgentOutputInvalidError(
        CaptureSessionUseCase.name,
        'A browser is already open for another sign-in. Finish or close that one first.',
        { captureId: this.running },
      );
    }
    if (this.capturers[input.platform] === undefined) {
      throw new AgentOutputInvalidError(
        CaptureSessionUseCase.name,
        `${input.platform} cannot be connected by signing in yet.`,
        { platform: input.platform },
      );
    }

    const id = `capture-${String(Date.now())}`;
    const state: CaptureStateDto = {
      id,
      status: CaptureStatus.Waiting,
      message: null,
      credentialId: null,
    };

    this.captures.set(id, state);
    this.running = id;

    // Deliberately not awaited: the caller is an HTTP request that must answer
    // now. Every path inside settles the capture, so nothing is left `WAITING`.
    void this.run(id, input.platform, input.label);

    return state;
  }

  /** Where a capture has got to, or null once it has been forgotten. */
  public status(id: string): CaptureStateDto | null {
    return this.captures.get(id) ?? null;
  }

  /** Waits for the sign-in, stores what comes back, and records the outcome. */
  private async run(id: string, platform: CredentialPlatform, label: string): Promise<void> {
    try {
      const capturer = this.capturers[platform];

      if (capturer === undefined) {
        throw new AgentOutputInvalidError(
          CaptureSessionUseCase.name,
          `${platform} cannot be connected by signing in yet.`,
          { platform },
        );
      }

      const storageState = await capturer.captureSession(this.timeoutMs);
      this.set(id, { status: CaptureStatus.Saving });

      const credential = await this.manageCredentialsUseCase.connect({
        platform,
        authMethod: CredentialAuthMethod.Browser,
        label,
        fields: { [SESSION_FIELD]: storageState },
      });

      this.set(id, { status: CaptureStatus.Saved, credentialId: credential.id });

      this.logger.info('Connected an account by signing in', {
        source: CaptureSessionUseCase.name,
        platform,
        label,
      });
    } catch (error) {
      // The message is shown to whoever clicked the button, so a typed error's
      // own wording is used where there is one — those are written for people.
      this.set(id, {
        status: CaptureStatus.Failed,
        message: isApplicationError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Signing in did not finish.',
      });

      this.logger.warn('Signing in did not finish', {
        source: CaptureSessionUseCase.name,
        platform,
        label,
      });
    } finally {
      this.running = null;
      // Freed on a timer rather than on read: the browser tab may poll once
      // more after the result, and may equally have been closed already.
      setTimeout(() => this.captures.delete(id), KEEP_RESULT_MS).unref();
    }
  }

  private set(id: string, patch: Partial<Omit<CaptureStateDto, 'id'>>): void {
    const current = this.captures.get(id);

    if (current === undefined) return;

    this.captures.set(id, { ...current, ...patch });
  }
}
