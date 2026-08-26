import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // GCM's standard nonce size
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-SHA256

/**
 * Field-level encryption for data that must not be readable in a database dump:
 * national ID numbers, bank details, health notes.
 *
 * AES-256-**GCM**, not CBC. GCM is authenticated — a ciphertext altered in the
 * database fails to decrypt instead of silently yielding different plaintext.
 * Unauthenticated modes are the reason padding-oracle attacks exist.
 *
 * A fresh salt and IV per record, both stored alongside the ciphertext. Reusing
 * a nonce with GCM is catastrophic: two messages under one nonce leak their XOR
 * and let an attacker forge tags.
 *
 * This is NOT a substitute for RLS or for TLS. It protects one thing: a copy of
 * the data taken without the key.
 */
export class Encryption {
  // An explicit field rather than a parameter property: this file is deliberately
  // plain, erasable TypeScript so `node --test` can run it with no build step.
  private readonly masterKey: string;

  constructor(masterKey: string) {
    if (masterKey.length < 32) {
      // A short key defeats the 600k iterations entirely — fail at construction,
      // not at the first decrypt in production.
      throw new Error('encryption key must be at least 32 characters');
    }
    this.masterKey = masterKey;
  }

  private derive(salt: Buffer): Buffer {
    return pbkdf2Sync(this.masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  }

  /** Returns `salt.iv.tag.ciphertext`, base64url, safe for a text column. */
  encrypt(plaintext: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.derive(salt), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [salt, iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.');
  }

  decrypt(encoded: string): string {
    const parts = encoded.split('.');
    if (parts.length !== 4) throw new Error('ciphertext is malformed');

    const [salt, iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'));
    if (!salt || !iv || !tag || !ciphertext) throw new Error('ciphertext is malformed');
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || salt.length !== SALT_LENGTH) {
      throw new Error('ciphertext is malformed');
    }

    const decipher = createDecipheriv(ALGORITHM, this.derive(salt), iv);
    decipher.setAuthTag(tag);
    // Throws if the tag does not verify — which is the point. A failure here
    // means the data was altered, and it must not be treated as a soft error.
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /**
   * Constant-time comparison for secrets (API keys, webhook signatures).
   *
   * `===` on a secret leaks its prefix through timing. The length check first is
   * required: `timingSafeEqual` throws on a length mismatch, and that throw is
   * itself an oracle if it escapes.
   */
  static secureEquals(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  /** A cryptographically random token. Never Math.random. */
  static token(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}
