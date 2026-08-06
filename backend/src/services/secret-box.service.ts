import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { CredentialsConfig } from '../config/app.config.js';
import type { SealedSecret } from '../dto/credential.dto.js';
import { ConfigurationError } from '../types/errors/configuration.error.js';

export type { SealedSecret };

/**
 * Contract for encrypting values that must survive in the database without
 * being readable from it.
 *
 * External system: none — this is `node:crypto`. It sits in the services layer
 * because it is infrastructure with no business rules: it does not know what a
 * credential is, only how to seal bytes.
 */
export interface SecretBox {
  seal(plainText: string): SealedSecret;
  /** @throws {ConfigurationError} When the key cannot open it. */
  open(sealed: SealedSecret): string;
}

/** AES-GCM wants 96 bits of IV; longer buys nothing and costs interoperability. */
const IV_BYTES = 12;
const ALGORITHM = 'aes-256-gcm';

/**
 * AES-256-GCM, with the key derived from configuration.
 *
 * GCM rather than CBC because it authenticates as well as encrypts: a
 * ciphertext altered in the database fails to open rather than decrypting to
 * something plausible. A fresh IV per record means two accounts with the same
 * password do not produce the same bytes.
 *
 * The key never touches the database. Losing the database therefore loses the
 * ciphertexts and nothing else; losing `CREDENTIALS_KEY` loses the ability to
 * read them, which is the trade a secret store exists to make.
 */
export class AesSecretBox implements SecretBox {
  private readonly key: Buffer;

  constructor(config: CredentialsConfig) {
    // The configured value is any length; AES needs exactly 32 bytes. SHA-256
    // gives that deterministically without asking an operator to produce
    // base64 of the right size.
    this.key = createHash('sha256').update(config.key).digest();
  }

  public seal(plainText: string): SealedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const cipherText = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);

    return {
      cipherText: cipherText.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  public open(sealed: SealedSecret): string {
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(sealed.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));

      return Buffer.concat([
        decipher.update(Buffer.from(sealed.cipherText, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Either the key changed or the row was tampered with. The two are
      // indistinguishable from here, and both mean the same thing to a caller:
      // this value cannot be trusted.
      throw new ConfigurationError('A stored credential could not be decrypted.', {
        reason: 'wrong CREDENTIALS_KEY, or the record was altered',
      });
    }
  }
}
