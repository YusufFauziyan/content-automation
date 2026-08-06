import { describe, expect, it } from 'vitest';

import {
  CredentialAuthMethod,
  CredentialPlatform,
  type CredentialDto,
} from '../../../src/dto/credential.dto.js';
import type { CredentialRepository } from '../../../src/repositories/credential.repository.js';
import { ErrorCode } from '../../../src/types/errors/error-code.js';
import { NoopLogger } from '../../../src/utils/logger/noop.logger.js';
import {
  ManageCredentialsUseCase,
  REQUIRED_FIELDS,
  SESSION_FIELD,
} from '../../../src/use-cases/manage-credentials.usecase.js';
import { asFake } from '../../support/fakes.js';

/** A minimal Playwright storage state — the shape, not a real session. */
const SESSION = JSON.stringify({
  cookies: [{ name: 'sessionid', value: 'x', domain: '.tiktok.com' }],
  origins: [],
});

interface Saved {
  authMethod: CredentialAuthMethod;
  fieldNames: readonly string[];
  sealed: { cipherText: string };
}

const repositoryInto = (saves: Saved[]): CredentialRepository =>
  asFake<CredentialRepository>({
    save: (input) => {
      saves.push({
        authMethod: input.authMethod,
        fieldNames: input.fieldNames,
        sealed: input.sealed,
      });

      return Promise.resolve(asFake<CredentialDto>({ id: 'credential-1' }));
    },
  });

/** Seals by wrapping, so a test can read what was handed to the box. */
const passthroughBox = {
  seal: (plainText: string) => ({ cipherText: plainText, iv: 'iv', tag: 'tag' }),
};

const useCaseInto = (saves: Saved[]) =>
  new ManageCredentialsUseCase(repositoryInto(saves), passthroughBox, new NoopLogger());

/** Reads back what the use case sealed, since the fake box does not encrypt. */
const sealedFields = (saved: Saved): Record<string, string> =>
  JSON.parse(saved.sealed.cipherText) as Record<string, string>;

describe('ManageCredentialsUseCase connecting by browser session', () => {
  it('stores a captured session as the only field it needs', async () => {
    const saves: Saved[] = [];

    await useCaseInto(saves).connect({
      platform: CredentialPlatform.TikTok,
      authMethod: CredentialAuthMethod.Browser,
      label: '@yu.tomation',
      fields: { [SESSION_FIELD]: SESSION },
    });

    expect(saves[0]?.authMethod).toBe(CredentialAuthMethod.Browser);
    expect(saves[0]?.fieldNames).toEqual([SESSION_FIELD]);

    // Stored normalised rather than verbatim: a paste may arrive in any of
    // three shapes, and the uploader should only ever meet one.
    const stored = JSON.parse(sealedFields(saves[0]!)[SESSION_FIELD] ?? '') as {
      cookies: { name: string }[];
    };

    expect(stored.cookies.map((cookie) => cookie.name)).toContain('sessionid');
  });

  it('refuses a paste that is not a Playwright session', async () => {
    // The likeliest mistake is pasting the wrong file, and it has to be caught
    // here: an unusable session next fails in a scheduled run at 3am.
    const attempt = useCaseInto([]).connect({
      platform: CredentialPlatform.TikTok,
      authMethod: CredentialAuthMethod.Browser,
      label: '@yu.tomation',
      fields: { [SESSION_FIELD]: '{"token":"not-a-session"}' },
    });

    await expect(attempt).rejects.toMatchObject({ code: ErrorCode.AgentOutputInvalid });
  });

  it('takes a Cookie header, because that is what a person can actually copy', async () => {
    // TikTok refuses to finish a sign-in inside an automated browser, so the
    // way through is to log in normally and bring the cookies across. Requiring
    // a particular file format would close the only door that reliably opens.
    const saves: Saved[] = [];

    await useCaseInto(saves).connect({
      platform: CredentialPlatform.TikTok,
      authMethod: CredentialAuthMethod.Browser,
      label: '@yu.tomation',
      fields: { [SESSION_FIELD]: 'tt_webid=999; sessionid=abc123' },
    });

    expect(saves[0]?.authMethod).toBe(CredentialAuthMethod.Browser);
  });

  it('refuses text that is no kind of session', async () => {
    const attempt = useCaseInto([]).connect({
      platform: CredentialPlatform.TikTok,
      authMethod: CredentialAuthMethod.Browser,
      label: '@yu.tomation',
      fields: { [SESSION_FIELD]: 'I am not sure what to paste here' },
    });

    await expect(attempt).rejects.toMatchObject({ code: ErrorCode.AgentOutputInvalid });
  });

  it('does not offer browser sign-in for a platform that has no route yet', async () => {
    const attempt = useCaseInto([]).connect({
      platform: CredentialPlatform.YouTube,
      authMethod: CredentialAuthMethod.Browser,
      label: '@yu.tomation',
      fields: { [SESSION_FIELD]: SESSION },
    });

    await expect(attempt).rejects.toMatchObject({ code: ErrorCode.AgentOutputInvalid });
  });
});

describe('ManageCredentialsUseCase connecting by API', () => {
  it('keeps the OAuth fields separate from the session route', async () => {
    const saves: Saved[] = [];

    await useCaseInto(saves).connect({
      platform: CredentialPlatform.TikTok,
      authMethod: CredentialAuthMethod.Api,
      label: '@yu.tomation',
      fields: {
        clientKey: 'k',
        clientSecret: 's',
        accessToken: 'a',
        refreshToken: 'r',
      },
    });

    expect(saves[0]?.authMethod).toBe(CredentialAuthMethod.Api);
    expect(saves[0]?.fieldNames).toEqual(REQUIRED_FIELDS.TIKTOK.API);
    expect(saves[0]?.fieldNames).not.toContain(SESSION_FIELD);
  });

  it('drops fields the platform did not ask for', async () => {
    // An operator pasting a whole JSON blob should not have the surplus quietly
    // kept for ever — least of all a value that looks like a password.
    const saves: Saved[] = [];

    await useCaseInto(saves).connect({
      platform: CredentialPlatform.YouTube,
      authMethod: CredentialAuthMethod.Api,
      label: '@yu.tomation',
      fields: {
        clientId: 'i',
        clientSecret: 's',
        refreshToken: 'r',
        password: 'should-not-survive',
      },
    });

    expect(Object.keys(sealedFields(saves[0]!))).not.toContain('password');
  });

  it('names every field that is missing rather than only the first', async () => {
    const attempt = useCaseInto([]).connect({
      platform: CredentialPlatform.TikTok,
      authMethod: CredentialAuthMethod.Api,
      label: '@yu.tomation',
      fields: { clientKey: 'k' },
    });

    await expect(attempt).rejects.toMatchObject({
      message: expect.stringContaining('refreshToken') as unknown as string,
    });
  });
});
