import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "./crypto";

const key = randomBytes(32);

describe("encryptSecret / decryptSecret", () => {
  test("round-trips a refresh token", () => {
    const plaintext = "1//0eXampleRefreshTokenValue.abc123";
    const enc = encryptSecret(plaintext, key);
    expect(decryptSecret(enc, key)).toBe(plaintext);
  });

  test("produces different ciphertexts for the same input (random IV)", () => {
    const a = encryptSecret("same", key);
    const b = encryptSecret("same", key);
    expect(a.ciphertext === b.ciphertext && a.iv === b.iv).toBe(false);
    expect(decryptSecret(a, key)).toBe("same");
    expect(decryptSecret(b, key)).toBe("same");
  });

  test("rejects key of wrong length", () => {
    const wrong = randomBytes(16);
    expect(() => encryptSecret("x", wrong)).toThrow();
    const enc = encryptSecret("x", key);
    expect(() => decryptSecret(enc, wrong)).toThrow();
  });

  test("rejects decryption with a different 32-byte key (mismatched key)", () => {
    const otherKey = randomBytes(32);
    const enc = encryptSecret("topsecret", key);
    expect(() => decryptSecret(enc, otherKey)).toThrow();
  });

  test("rejects tampered ciphertext", () => {
    const enc = encryptSecret("secret", key);
    const tampered = {
      ...enc,
      ciphertext: Buffer.from("Y29ycnVwdGVk", "base64").toString("base64"),
    };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  test("rejects ciphertext with a single byte flipped", () => {
    const enc = encryptSecret("secret-payload", key);
    const raw = Buffer.from(enc.ciphertext, "base64");
    // Flip the first byte
    raw[0] = (raw[0] ?? 0) ^ 0x01;
    const tampered = { ...enc, ciphertext: raw.toString("base64") };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  test("rejects tampered auth tag", () => {
    const enc = encryptSecret("secret", key);
    const wrongTag = Buffer.alloc(16, 0).toString("base64");
    expect(() => decryptSecret({ ...enc, authTag: wrongTag }, key)).toThrow();
  });
});

describe("loadEncryptionKey", () => {
  test("loads a 32-byte base64 key", () => {
    const env = randomBytes(32).toString("base64");
    const k = loadEncryptionKey(env);
    expect(k.length).toBe(32);
  });

  test("rejects undefined", () => {
    expect(() => loadEncryptionKey(undefined)).toThrow("ENCRYPTION_KEY is not set");
  });

  test("rejects wrong length", () => {
    const env = randomBytes(16).toString("base64");
    expect(() => loadEncryptionKey(env)).toThrow();
  });

  test("works when read from process.env (parity with config loader)", () => {
    const prev = process.env.ENCRYPTION_KEY;
    try {
      process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
      const k = loadEncryptionKey(process.env.ENCRYPTION_KEY);
      expect(k.length).toBe(32);
      // round-trip with this key proves it is wired correctly
      const enc = encryptSecret("via-env", k);
      expect(decryptSecret(enc, k)).toBe("via-env");
    } finally {
      if (prev === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = prev;
    }
  });
});
