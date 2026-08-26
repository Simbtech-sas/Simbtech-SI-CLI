import { Encryption } from './encryption';

const service = new Encryption('test_key_at_least_32_characters_long_x');

it('round-trips, including unicode and empty input', () => {
  for (const plaintext of ['hello', '', 'Ébène — 中文 — 🔐', 'x'.repeat(10_000)]) {
    expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
  }
});

it('the same plaintext never produces the same ciphertext', () => {
  // A fresh salt and IV per record. Deterministic ciphertext leaks equality:
  // an attacker learns which rows share a value without decrypting anything.
  const a = service.encrypt('same');
  const b = service.encrypt('same');
  expect(a).not.toBe(b);
  expect(service.decrypt(a)).toBe(service.decrypt(b));
});

it('a tampered ciphertext fails to decrypt rather than returning wrong data', () => {
  // The reason for GCM over CBC. An unauthenticated mode would return plausible
  // garbage here instead of throwing.
  const encrypted = service.encrypt('sensitive');
  const parts = encrypted.split('.');
  const body = Buffer.from(parts[3]!, 'base64url');
  body[0] ^= 0xff;
  parts[3] = body.toString('base64url');
  expect(() => service.decrypt(parts.join('.'))).toThrow();
});

it('a swapped auth tag is rejected', () => {
  const a = service.encrypt('one').split('.');
  const b = service.encrypt('two').split('.');
  a[2] = b[2]; // graft b's tag onto a
  expect(() => service.decrypt(a.join('.'))).toThrow();
});

it('malformed input throws instead of half-decrypting', () => {
  for (const bad of ['', 'notbase64', 'a.b.c', 'a.b.c.d.e']) {
    expect(() => service.decrypt(bad)).toThrow();
  }
});

it('a different key cannot read the data', () => {
  const other = new Encryption('a_completely_different_key_32_chars_x');
  expect(() => other.decrypt(service.encrypt('secret'))).toThrow();
});

it('secureEquals is correct and length-safe', () => {
  // timingSafeEqual throws on a length mismatch; that throw would itself be an
  // oracle if it escaped.
  expect(Encryption.secureEquals('abc', 'abc')).toBe(true);
  expect(Encryption.secureEquals('abc', 'abd')).toBe(false);
  expect(Encryption.secureEquals('abc', 'abcd')).toBe(false);
  expect(Encryption.secureEquals('', 'a')).toBe(false);
  expect(Encryption.secureEquals('', '')).toBe(true);
});

it('tokens are random and long enough', () => {
  const tokens = new Set(Array.from({ length: 500 }, () => Encryption.token()));
  expect(tokens.size).toBe(500);
  expect(Encryption.token().length).toBeGreaterThanOrEqual(43);
});

it('a short key is rejected at construction, not at first use', () => {
  // 600k iterations do nothing for a 5-character key. Failing here beats
  // discovering it when the first record is written in production.
  expect(() => new Encryption('short')).toThrow(/at least 32/);
});
