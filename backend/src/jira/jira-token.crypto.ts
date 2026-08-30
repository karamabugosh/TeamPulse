import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptSecret(ciphertext: string, secret: string): string {
  const buffer = Buffer.from(ciphertext, 'base64');
  const iv = buffer.subarray(0, 16);
  const tag = buffer.subarray(16, 32);
  const encrypted = buffer.subarray(32);
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

export function signOAuthState(payload: string, secret: string): string {
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
): string | null {
  const separatorIndex = state.lastIndexOf('.');
  if (separatorIndex <= 0) {
    return null;
  }

  const payload = state.slice(0, separatorIndex);
  const signature = state.slice(separatorIndex + 1);
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  return payload;
}
