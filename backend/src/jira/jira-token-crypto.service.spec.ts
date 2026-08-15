import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { JiraTokenCryptoService } from './jira-token-crypto.service';

const createEncodedKey = (fillValue: number): string =>
  Buffer.alloc(32, fillValue).toString('base64');

const createService = (
  encodedKey = createEncodedKey(7),
): JiraTokenCryptoService => {
  const configService = new ConfigService({
    JIRA_TOKEN_ENCRYPTION_KEY: encodedKey,
  });

  return new JiraTokenCryptoService(configService);
};

const tamperWithCiphertext = (
  encryptedValue: string,
): string => {
  const parts = encryptedValue.split('.');

  assert.equal(parts.length, 4);

  const ciphertext = parts[3];

  assert.ok(ciphertext.length > 0);

  const replacement =
    ciphertext[0] === 'A' ? 'B' : 'A';

  parts[3] = `${replacement}${ciphertext.slice(1)}`;

  return parts.join('.');
};

describe('JiraTokenCryptoService', () => {
  test('encrypts and decrypts a Jira OAuth token', () => {
    const service = createService();
    const token = 'jira-access-token-value';

    const encryptedValue = service.encrypt(token);
    const decryptedValue = service.decrypt(encryptedValue);

    assert.notEqual(encryptedValue, token);
    assert.equal(decryptedValue, token);
    assert.match(encryptedValue, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
  });

  test('uses a different IV for every encryption', () => {
    const service = createService();
    const token = 'same-token-value';

    const firstEncryptedValue = service.encrypt(token);
    const secondEncryptedValue = service.encrypt(token);

    assert.notEqual(
      firstEncryptedValue,
      secondEncryptedValue,
    );

    assert.equal(
      service.decrypt(firstEncryptedValue),
      token,
    );

    assert.equal(
      service.decrypt(secondEncryptedValue),
      token,
    );
  });

  test('rejects ciphertext that has been modified', () => {
    const service = createService();
    const encryptedValue = service.encrypt(
      'sensitive-refresh-token',
    );

    const modifiedValue =
      tamperWithCiphertext(encryptedValue);

    assert.throws(
      () => service.decrypt(modifiedValue),
      /Unable to decrypt the Jira OAuth token/,
    );
  });

  test('rejects decryption with a different key', () => {
    const firstService = createService(
      createEncodedKey(1),
    );

    const secondService = createService(
      createEncodedKey(2),
    );

    const encryptedValue = firstService.encrypt(
      'jira-token',
    );

    assert.throws(
      () => secondService.decrypt(encryptedValue),
      /Unable to decrypt the Jira OAuth token/,
    );
  });

  test('rejects an empty token', () => {
    const service = createService();

    assert.throws(
      () => service.encrypt(''),
      /Cannot encrypt an empty Jira OAuth token/,
    );
  });

  test('rejects a missing encryption key', () => {
    const configService = new ConfigService({});

    assert.throws(
      () =>
        new JiraTokenCryptoService(configService),
      /JIRA_TOKEN_ENCRYPTION_KEY is required/,
    );
  });

  test('rejects an encryption key with the wrong length', () => {
    const configService = new ConfigService({
      JIRA_TOKEN_ENCRYPTION_KEY:
        Buffer.alloc(16, 3).toString('base64'),
    });

    assert.throws(
      () =>
        new JiraTokenCryptoService(configService),
      /must be a Base64-encoded 32-byte key/,
    );
  });
});