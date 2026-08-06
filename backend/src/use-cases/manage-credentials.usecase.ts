import {
  CredentialAuthMethod,
  CredentialPlatform,
  type CredentialDto,
  type NewCredentialDto,
} from '../dto/credential.dto.js';
import type { CredentialRepository } from '../repositories/credential.repository.js';
import { AgentOutputInvalidError } from '../types/errors/agent.error.js';
import type { Logger } from '../types/logger.js';
import {
  importSession,
  type SessionPlatform,
} from '../utils/credential/session-import.js';

/**
 * The single field a captured browser session is stored under.
 *
 * Playwright's own `storageState` is the unit deliberately: cookies alone are
 * not enough for TikTok, which keeps part of its signed-in state in local
 * storage. Storing the whole state means what is replayed is exactly what was
 * captured, rather than a subset that works until it does not.
 */
export const SESSION_FIELD = 'storageState';

/**
 * What each platform needs before it can publish, per route in.
 *
 * Declared here rather than in the UI because it is a rule about the domain: a
 * TikTok credential without a refresh token will fail at upload time, and the
 * place to refuse it is before it is stored, not months later in a workflow.
 *
 * A missing entry means that platform cannot be reached that way yet. That is
 * an absence with meaning, so {@link ManageCredentialsUseCase.connect} refuses
 * it by name rather than treating it as "no fields required".
 */
export const REQUIRED_FIELDS: Record<
  CredentialPlatform,
  Partial<Record<CredentialAuthMethod, readonly string[]>>
> = {
  [CredentialPlatform.TikTok]: {
    [CredentialAuthMethod.Api]: ['clientKey', 'clientSecret', 'accessToken', 'refreshToken'],
    [CredentialAuthMethod.Browser]: [SESSION_FIELD],
  },
  [CredentialPlatform.Instagram]: {
    [CredentialAuthMethod.Api]: ['appId', 'appSecret', 'accessToken', 'igUserId'],
  },
  [CredentialPlatform.Threads]: {
    [CredentialAuthMethod.Api]: ['appId', 'appSecret', 'accessToken', 'threadsUserId'],
  },
  [CredentialPlatform.YouTube]: {
    [CredentialAuthMethod.Api]: ['clientId', 'clientSecret', 'refreshToken'],
    [CredentialAuthMethod.Browser]: [SESSION_FIELD],
  },
};

/**
 * What to say when a paste could not be made into a session.
 *
 * Each reason needs a different thing from the person holding the form, so each
 * gets its own sentence. A single "invalid session" would leave all three of
 * them re-pasting the same wrong thing.
 */
const WHY_NOT: Readonly<Record<string, string>> = {
  unreadable:
    'That could not be read as a session. Paste the file from `pnpm tiktok:login`, a cookie export from your browser, or the `Cookie:` header line.',
  'no-cookies': 'That contained no cookies at all.',
  'not-signed-in':
    'Those cookies are not signed in — the ones that carry a session are missing. Log in to the platform in your browser first, then export its cookies.',
};

/**
 * The business operations for the accounts videos are published to.
 *
 * Every path in and out of here is one-way: values go in and are sealed before
 * they reach the repository; what comes back describes a credential without
 * containing one. There is deliberately no "read the secret" operation — the
 * upload agent will take one when that step is built, and it will be the only
 * caller that can.
 */
export class ManageCredentialsUseCase {
  constructor(
    private readonly credentialRepository: CredentialRepository,
    private readonly secretBox: { seal: (plainText: string) => { cipherText: string; iv: string; tag: string } },
    private readonly logger: Logger,
  ) {}

  public list(): Promise<readonly CredentialDto[]> {
    return this.credentialRepository.findAll();
  }

  /**
   * @throws {AgentOutputInvalidError} When a required field is missing or blank.
   */
  public async connect(input: NewCredentialDto): Promise<CredentialDto> {
    const required = REQUIRED_FIELDS[input.platform][input.authMethod];

    if (required === undefined) {
      throw new AgentOutputInvalidError(
        'ManageCredentialsUseCase',
        `${input.platform} cannot be connected by ${input.authMethod} yet.`,
        { platform: input.platform, authMethod: input.authMethod },
      );
    }

    const missing = required.filter((name) => (input.fields[name] ?? '').trim() === '');

    if (missing.length > 0) {
      throw new AgentOutputInvalidError(
        'ManageCredentialsUseCase',
        `${input.platform} also needs ${missing.join(', ')}.`,
        { platform: input.platform, missing },
      );
    }

    // Only the fields the platform declared. An operator pasting a whole JSON
    // blob should not have the surplus quietly preserved for ever.
    const fields = Object.fromEntries(required.map((name) => [name, input.fields[name] ?? '']));

    if (input.authMethod === CredentialAuthMethod.Browser) {
      const session = importSession(
        input.fields[SESSION_FIELD] ?? '',
        input.platform as SessionPlatform,
      );

      if (!session.ok) {
        throw new AgentOutputInvalidError(
          'ManageCredentialsUseCase',
          WHY_NOT[session.reason] ?? 'That could not be read as a session.',
          { platform: input.platform, reason: session.reason },
        );
      }

      // Stored normalised, whatever it arrived as: the uploader then has one
      // shape to replay, and a browser extension's spelling of `sameSite` is
      // this file's problem rather than the browser's.
      fields[SESSION_FIELD] = JSON.stringify(session.state);
    }
    const sealed = this.secretBox.seal(JSON.stringify(fields));

    const credential = await this.credentialRepository.save({
      platform: input.platform,
      authMethod: input.authMethod,
      label: input.label,
      sealed,
      fieldNames: required,
    });

    this.logger.info('Credential connected', {
      source: ManageCredentialsUseCase.name,
      platform: input.platform,
      authMethod: input.authMethod,
      label: input.label,
      // The field names, never the values.
      fields: required.length,
    });

    return credential;
  }

  public setEnabled(id: string, enabled: boolean): Promise<CredentialDto> {
    return this.credentialRepository.setEnabled(id, enabled);
  }

  public async remove(ids: readonly string[]): Promise<number> {
    const deleted = await this.credentialRepository.delete(ids);

    this.logger.info('Credentials removed', {
      source: ManageCredentialsUseCase.name,
      deleted,
    });

    return deleted;
  }
}
