import { describe, expect, it } from 'vitest';

import { BrowserUploadAgent } from '../../../src/agents/upload.agent.js';
import {
  CredentialAuthMethod,
  type CredentialDto,
  type SealedCredential,
} from '../../../src/dto/credential.dto.js';
import type { UploadDto, UploadRequestDto } from '../../../src/dto/upload.dto.js';
import type { VideoDto } from '../../../src/dto/video.dto.js';
import type { CredentialRepository } from '../../../src/repositories/credential.repository.js';
import type { UploadRepository } from '../../../src/repositories/upload.repository.js';
import type {
  PlaywrightService,
  PublishRequest,
  PublishResult,
} from '../../../src/services/playwright.service.js';
import type { SecretBox } from '../../../src/services/secret-box.service.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import { UploadPlatform, UploadStatus } from '../../../src/types/upload.js';
import { asFake } from '../../support/fakes.js';

const SESSION = '{"cookies":[],"origins":[]}';

const account = asFake<CredentialDto>({
  id: 'credential-1',
  label: '@yu.tomation',
  authMethod: CredentialAuthMethod.Browser,
});

const request: UploadRequestDto = {
  contentId: 'content-1',
  platform: UploadPlatform.TikTok,
  video: asFake<VideoDto>({ absolutePath: '/runs/1/video/final.mp4' }),
  title: 'Why do sea otters hold hands?',
  description: 'So they do not drift apart while they sleep.',
  hashtags: ['#facts'],
};

/** Records every status the agent wrote, in order. */
const uploadsInto = (statuses: UploadStatus[]): UploadRepository =>
  asFake<UploadRepository>({
    open: (input) => {
      statuses.push(input.status);

      return Promise.resolve(asFake<UploadDto>({ id: 'upload-1', contentId: input.contentId }));
    },
    updateResult: (id, input) => {
      statuses.push(input.status);

      return Promise.resolve(asFake<UploadDto>({ id, contentId: 'content-1' }));
    },
  });

const credentialsWith = (
  found: CredentialDto | null,
  sealed: SealedCredential | null = asFake<SealedCredential>({
    sealed: { cipherText: 'c', iv: 'i', tag: 't' },
  }),
  used: string[] = [],
): CredentialRepository =>
  asFake<CredentialRepository>({
    findUsable: () => Promise.resolve(found),
    findSealed: () => Promise.resolve(sealed),
    markUsed: (id) => {
      used.push(id);

      return Promise.resolve();
    },
  });

/** Opens to whatever the test says the sealed credential contained. */
const boxHolding = (fields: Record<string, string>): SecretBox =>
  asFake<SecretBox>({ open: () => JSON.stringify(fields) });

const playwrightThat = (
  outcome: PublishResult | Error,
  verifies = true,
  seen: PublishRequest[] = [],
): PlaywrightService =>
  asFake<PlaywrightService>({
    publish: (input) => {
      seen.push(input);

      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
    verify: () => Promise.resolve(verifies),
  });

const published: PublishResult = {
  externalId: '7123',
  externalUrl: 'https://www.tiktok.com/@yu.tomation/video/7123',
};

describe('BrowserUploadAgent', () => {
  it('publishes with the stored session and marks the account used', async () => {
    const statuses: UploadStatus[] = [];
    const used: string[] = [];
    const seen: PublishRequest[] = [];

    const result = await new BrowserUploadAgent(
      { TIKTOK: playwrightThat(published, true, seen) },
      credentialsWith(account, undefined, used),
      uploadsInto(statuses),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(true);
    expect(seen[0]?.session).toEqual({ storageState: SESSION, handle: '@yu.tomation' });
    expect(used).toEqual(['credential-1']);
  });

  it('records how far it got, so a killed process leaves a readable row', async () => {
    const statuses: UploadStatus[] = [];

    await new BrowserUploadAgent(
      { TIKTOK: playwrightThat(published) },
      credentialsWith(account),
      uploadsInto(statuses),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(statuses).toEqual([
      UploadStatus.Pending,
      UploadStatus.Uploading,
      UploadStatus.Uploaded,
      UploadStatus.Verified,
    ]);
  });

  it('stops at uploaded when the video cannot be confirmed, without failing the run', async () => {
    // Two separate facts. The video is on the platform — reporting a failure
    // would invite a second publish of something already live. But VERIFIED is
    // the only status that will ever permit the render to be deleted, so an
    // unconfirmable upload must not reach it.
    const statuses: UploadStatus[] = [];

    const result = await new BrowserUploadAgent(
      { TIKTOK: playwrightThat(published, false) },
      credentialsWith(account),
      uploadsInto(statuses),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(true);
    expect(statuses).toContain(UploadStatus.Uploaded);
    expect(statuses).not.toContain(UploadStatus.Verified);
  });

  it('succeeds with no link at all, because the video is still published', async () => {
    // TikTok confirms the post immediately but takes a while to show it on the
    // profile. Failing here is what left runs hanging with the video already
    // posted; the link can be filled in from the Uploads page afterwards.
    const statuses: UploadStatus[] = [];

    const result = await new BrowserUploadAgent(
      { TIKTOK: playwrightThat({ externalId: null, externalUrl: null }) },
      credentialsWith(account),
      uploadsInto(statuses),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(true);
    expect(statuses).toEqual([
      UploadStatus.Pending,
      UploadStatus.Uploading,
      UploadStatus.Uploaded,
    ]);
  });

  it('refuses a platform it has no publisher for', async () => {
    const result = await new BrowserUploadAgent(
      {},
      credentialsWith(account),
      uploadsInto([]),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.CredentialMissing);
  });

  it('says no account is connected rather than failing obscurely', async () => {
    const result = await new BrowserUploadAgent(
      { TIKTOK: playwrightThat(published) },
      credentialsWith(null),
      uploadsInto([]),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.CredentialMissing);
  });

  it('reports an empty session as expired, and does not retry it', async () => {
    // Retrying cannot produce a session. Reporting it as retryable would send
    // the workflow round three times before showing the one useful message.
    const result = await new BrowserUploadAgent(
      { TIKTOK: playwrightThat(published) },
      credentialsWith(account),
      uploadsInto([]),
      boxHolding({}),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.code).toBe(ErrorCode.PublishSessionExpired);
    expect(result.success ? null : result.error.retryable).toBe(false);
  });

  it('treats an unrecognised browser crash as worth one more try', async () => {
    const statuses: UploadStatus[] = [];

    const result = await new BrowserUploadAgent(
      { TIKTOK: playwrightThat(new Error('Target page closed')) },
      credentialsWith(account),
      uploadsInto(statuses),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.retryable).toBe(true);
    expect(statuses).toContain(UploadStatus.Failed);
  });
});

describe('BrowserUploadAgent publishing a second time', () => {
  it('reopens the destination row rather than demanding a new one', async () => {
    // `uploads` holds one row per destination. A retry that insists on
    // inserting hits the unique constraint and fails with "create failed" —
    // which is a database error standing in for "this was already tried".
    const opened: { contentId: string; platform: UploadPlatform }[] = [];

    const result = await new BrowserUploadAgent(
      { TIKTOK: playwrightThat(published) },
      credentialsWith(account),
      asFake<UploadRepository>({
        open: (input) => {
          opened.push({ contentId: input.contentId, platform: input.platform });

          return Promise.resolve(asFake<UploadDto>({ id: 'upload-1' }));
        },
        updateResult: (id) => Promise.resolve(asFake<UploadDto>({ id })),
      }),
      boxHolding({ storageState: SESSION }),
      new NoopLogger(),
    ).execute(request);

    expect(result.success).toBe(true);
    expect(opened).toEqual([{ contentId: 'content-1', platform: UploadPlatform.TikTok }]);
  });
});
