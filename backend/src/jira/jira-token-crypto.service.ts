import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32;
const ENCRYPTED_VALUE_VERSION = 'v1';
const TOKEN_AAD = Buffer.from(
  'teampulse:jira-oauth-token:v1',
  'utf8',
);

@Injectable()
export class JiraTokenCryptoService {
  private readonly encryptionKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    this.encryptionKey = this.loadEncryptionKey();
  }

  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
      throw new Error('Cannot encrypt an empty Jira OAuth token.');
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(
      ALGORITHM,
      this.encryptionKey,
      iv,
      {
        authTagLength: AUTH_TAG_LENGTH_BYTES,
      },
    );

    cipher.setAAD(TOKEN_AAD);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return [
      ENCRYPTED_VALUE_VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(encryptedValue: string): string {
    try {
      const parts = encryptedValue.split('.');

      if (parts.length !== 4) {
        throw new Error('Invalid encrypted token format.');
      }

      const [version, encodedIv, encodedAuthTag, encodedCiphertext] =
        parts;

      if (version !== ENCRYPTED_VALUE_VERSION) {
        throw new Error('Unsupported encrypted token version.');
      }

      const iv = Buffer.from(encodedIv, 'base64url');
      const authTag = Buffer.from(encodedAuthTag, 'base64url');
      const ciphertext = Buffer.from(
        encodedCiphertext,
        'base64url',
      );

      if (iv.length !== IV_LENGTH_BYTES) {
        throw new Error('Invalid encrypted token IV.');
      }

      if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
        throw new Error('Invalid encrypted token authentication tag.');
      }

      const decipher = createDecipheriv(
        ALGORITHM,
        this.encryptionKey,
        iv,
        {
          authTagLength: AUTH_TAG_LENGTH_BYTES,
        },
      );

      decipher.setAAD(TOKEN_AAD);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return plaintext.toString('utf8');
    } catch {
      throw new Error(
        'Unable to decrypt the Jira OAuth token.',
      );
    }
  }

  private loadEncryptionKey(): Buffer {
    const encodedKey = this.configService
      .get<string>('JIRA_TOKEN_ENCRYPTION_KEY')
      ?.trim();

    if (!encodedKey) {
      throw new Error(
        'JIRA_TOKEN_ENCRYPTION_KEY is required.',
      );
    }

    const decodedKey = Buffer.from(encodedKey, 'base64');

    if (decodedKey.length !== KEY_LENGTH_BYTES) {
      throw new Error(
        'JIRA_TOKEN_ENCRYPTION_KEY must be a Base64-encoded 32-byte key.',
      );
    }

    return decodedKey;
  }
}