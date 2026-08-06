import type { Database } from '../database/prisma.client.js';
import { runQuery } from '../database/query.js';
import type {
  CredentialAuthMethod,
  CredentialDto,
  CredentialPlatform,
  SealedCredential,
  SealedSecret,
} from '../dto/credential.dto.js';

interface CredentialRecord {
  id: string;
  platform: string;
  authMethod: string;
  label: string;
  secret: string;
  iv: string;
  tag: string;
  fieldNames: string[];
  enabled: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps a row onto the domain DTO — deliberately dropping the secret.
 *
 * The only way to obtain the ciphertext is {@link CredentialRepository.findSealed},
 * which exists for the one caller that must decrypt. Every other read cannot
 * leak it because it never had it.
 */
const toDto = (record: CredentialRecord): CredentialDto => ({
  id: record.id,
  platform: record.platform as CredentialPlatform,
  authMethod: record.authMethod as CredentialAuthMethod,
  label: record.label,
  fieldNames: record.fieldNames,
  enabled: record.enabled,
  lastUsedAt: record.lastUsedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

/**
 * Accounts the uploader may publish as.
 *
 * Table
 * - `credentials`
 *
 * Methods
 * - {@link save}, {@link findAll}, {@link findSealed}, {@link setEnabled}, {@link delete}
 *
 * Stores ciphertext and returns metadata. It does no encryption itself — that
 * belongs to a service — and it holds no rule about which platforms need which
 * fields, which belongs to a use case.
 */
export class CredentialRepository {
  constructor(private readonly database: Database) {}

  /** Connects an account, replacing whatever was stored for that handle. */
  public async save(input: {
    platform: CredentialPlatform;
    authMethod: CredentialAuthMethod;
    label: string;
    sealed: SealedSecret;
    fieldNames: readonly string[];
  }): Promise<CredentialDto> {
    // `authMethod` is part of the update, not only the insert: reconnecting the
    // same handle by a different route must move the row to that route, or the
    // uploader would read a browser session expecting OAuth tokens.
    const data = {
      authMethod: input.authMethod,
      secret: input.sealed.cipherText,
      iv: input.sealed.iv,
      tag: input.sealed.tag,
      fieldNames: [...input.fieldNames],
    };

    const record = await runQuery('CredentialRepository.save', () =>
      this.database.credential.upsert({
        where: { platform_label: { platform: input.platform, label: input.label } },
        create: { platform: input.platform, label: input.label, ...data },
        update: data,
      }),
    );

    return toDto(record);
  }

  public async findAll(): Promise<readonly CredentialDto[]> {
    const records = await runQuery('CredentialRepository.findAll', () =>
      this.database.credential.findMany({ orderBy: [{ platform: 'asc' }, { label: 'asc' }] }),
    );

    return records.map(toDto);
  }

  /**
   * The ciphertext, for the one caller that has to decrypt it.
   *
   * Named so that its use is visible in a diff: anything calling this is
   * handling a secret and should be read with that in mind.
   */
  public async findSealed(id: string): Promise<SealedCredential | null> {
    const record = await runQuery('CredentialRepository.findSealed', () =>
      this.database.credential.findUnique({ where: { id } }),
    );

    if (record === null) return null;

    return {
      authMethod: record.authMethod as CredentialAuthMethod,
      fieldNames: record.fieldNames,
      sealed: { cipherText: record.secret, iv: record.iv, tag: record.tag },
    };
  }

  /**
   * The newest usable account for a platform, or null when none is connected.
   *
   * Disabled rows are excluded here rather than by the caller: "paused" has one
   * meaning, and letting each caller re-decide it is how a paused account ends
   * up publishing.
   */
  public async findUsable(
    platform: CredentialPlatform,
    authMethod: CredentialAuthMethod,
  ): Promise<CredentialDto | null> {
    const record = await runQuery('CredentialRepository.findUsable', () =>
      this.database.credential.findFirst({
        where: { platform, authMethod, enabled: true },
        orderBy: { updatedAt: 'desc' },
      }),
    );

    return record === null ? null : toDto(record);
  }

  /** Records that an account was just published with. */
  public async markUsed(id: string, at: Date): Promise<void> {
    await runQuery('CredentialRepository.markUsed', () =>
      this.database.credential.update({ where: { id }, data: { lastUsedAt: at } }),
    );
  }

  public async setEnabled(id: string, enabled: boolean): Promise<CredentialDto> {
    const record = await runQuery('CredentialRepository.setEnabled', () =>
      this.database.credential.update({ where: { id }, data: { enabled } }),
    );

    return toDto(record);
  }

  public async delete(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const { count } = await runQuery('CredentialRepository.delete', () =>
      this.database.credential.deleteMany({ where: { id: { in: [...ids] } } }),
    );

    return count;
  }
}
