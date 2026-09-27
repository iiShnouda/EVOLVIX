import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM at-rest encryption for session material, plus token hashing.
 *
 * Layout of an encrypted blob:  [12-byte IV][16-byte auth tag][ciphertext]
 * The key is the 32-byte SESSION_ENCRYPTION_KEY (64 hex chars).
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyBuffer(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('SESSION_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

export function encryptToBuffer(plaintext: string, hexKey: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(hexKey), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptFromBuffer(blob: Buffer, hexKey: string): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', keyBuffer(hexKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Generate a high-entropy opaque token (URL-safe base64). */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** Deterministic SHA-256 hash for indexing/verifying opaque tokens (not for passwords). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
