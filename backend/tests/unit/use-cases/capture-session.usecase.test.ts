import { describe, expect, it } from 'vitest';

import {
  CaptureStatus,
  CredentialAuthMethod,
  CredentialPlatform,
  type CredentialDto,
  type NewCredentialDto,
  type SessionCapturer,
} from '../../../src/dto/credential.dto.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { CaptureSessionUseCase } from '../../../src/use-cases/capture-session.usecase.js';
import type { ManageCredentialsUseCase } from '../../../src/use-cases/manage-credentials.usecase.js';
import { asFake } from '../../support/fakes.js';

const SESSION = '{"cookies":[],"origins":[]}';
const TIMEOUT_MS = 1_000;

/** Statuses a capture stops at. `SAVING` is on the way, not the end of it. */
const TERMINAL: readonly CaptureStatus[] = [CaptureStatus.Saved, CaptureStatus.Failed];

/** Resolves when the capture has settled, however it settled. */
const settled = async (useCase: CaptureSessionUseCase, id: string): Promise<CaptureStatus> => {
  for (let tick = 0; tick < 50; tick += 1) {
    const status = useCase.status(id)?.status;

    if (status !== undefined && TERMINAL.includes(status)) return status;

    await Promise.resolve();
  }

  return CaptureStatus.Waiting;
};

const capturerThat = (outcome: string | Error): SessionCapturer => ({
  captureSession: () =>
    outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome),
});

const credentialsInto = (connected: NewCredentialDto[]): ManageCredentialsUseCase =>
  asFake<ManageCredentialsUseCase>({
    connect: (input) => {
      connected.push(input);

      return Promise.resolve(asFake<CredentialDto>({ id: 'credential-1' }));
    },
  });

describe('CaptureSessionUseCase', () => {
  it('answers before anyone has signed in', () => {
    // The caller is an HTTP request. Holding it open for the minutes a captcha
    // and an SMS take is a request that times out in some proxy in between.
    const state = new CaptureSessionUseCase(
      { TIKTOK: capturerThat(SESSION) },
      credentialsInto([]),
      TIMEOUT_MS,
      new NoopLogger(),
    ).start({ platform: CredentialPlatform.TikTok, label: '@yu.tomation' });

    expect(state.status).toBe(CaptureStatus.Waiting);
    expect(state.credentialId).toBeNull();
  });

  it('connects the account as a browser session once signed in', async () => {
    const connected: NewCredentialDto[] = [];
    const useCase = new CaptureSessionUseCase(
      { TIKTOK: capturerThat(SESSION) },
      credentialsInto(connected),
      TIMEOUT_MS,
      new NoopLogger(),
    );

    const { id } = useCase.start({
      platform: CredentialPlatform.TikTok,
      label: '@yu.tomation',
    });

    expect(await settled(useCase, id)).toBe(CaptureStatus.Saved);
    expect(connected[0]?.authMethod).toBe(CredentialAuthMethod.Browser);
    expect(connected[0]?.fields['storageState']).toBe(SESSION);
    expect(useCase.status(id)?.credentialId).toBe('credential-1');
  });

  it('refuses a second sign-in while a browser is already open', () => {
    const useCase = new CaptureSessionUseCase(
      { TIKTOK: capturerThat(SESSION) },
      credentialsInto([]),
      TIMEOUT_MS,
      new NoopLogger(),
    );

    useCase.start({ platform: CredentialPlatform.TikTok, label: '@one' });

    expect(() => useCase.start({ platform: CredentialPlatform.TikTok, label: '@two' })).toThrow(
      /already open/,
    );
  });

  it('frees the slot after a failure, so a retry is possible', async () => {
    const useCase = new CaptureSessionUseCase(
      { TIKTOK: capturerThat(new Error('The browser was closed before sign-in finished.')) },
      credentialsInto([]),
      TIMEOUT_MS,
      new NoopLogger(),
    );

    const { id } = useCase.start({ platform: CredentialPlatform.TikTok, label: '@yu.tomation' });

    expect(await settled(useCase, id)).toBe(CaptureStatus.Failed);
    expect(() => useCase.start({ platform: CredentialPlatform.TikTok, label: '@again' })).not.toThrow();
  });

  it('keeps the reason a sign-in failed, because a person is going to read it', async () => {
    const useCase = new CaptureSessionUseCase(
      { TIKTOK: capturerThat(new Error('No browser could be opened — it may have no display.')) },
      credentialsInto([]),
      TIMEOUT_MS,
      new NoopLogger(),
    );

    const { id } = useCase.start({ platform: CredentialPlatform.TikTok, label: '@yu.tomation' });
    await settled(useCase, id);

    expect(useCase.status(id)?.message).toContain('no display');
  });

  it('does not offer to sign in to a platform with no capturer configured', () => {
    // TikTok is wired here and YouTube is not, which is what an installation
    // with only one upload URL set looks like.
    const useCase = new CaptureSessionUseCase(
      { TIKTOK: capturerThat(SESSION) },
      credentialsInto([]),
      TIMEOUT_MS,
      new NoopLogger(),
    );

    expect(() =>
      useCase.start({ platform: CredentialPlatform.YouTube, label: '@yu.tomation' }),
    ).toThrow(/cannot be connected/);
  });

  it('signs in to whichever platform was asked for', async () => {
    const connected: NewCredentialDto[] = [];
    const useCase = new CaptureSessionUseCase(
      { YOUTUBE: capturerThat(SESSION) },
      credentialsInto(connected),
      TIMEOUT_MS,
      new NoopLogger(),
    );

    const { id } = useCase.start({ platform: CredentialPlatform.YouTube, label: '@yu.tomation' });

    expect(await settled(useCase, id)).toBe(CaptureStatus.Saved);
    expect(connected[0]?.platform).toBe(CredentialPlatform.YouTube);
  });
});
