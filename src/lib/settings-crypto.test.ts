import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  last4,
  parseEncryptionKey,
  SettingsEncryptionError,
} from "./settings-crypto";

const key = randomBytes(32);

describe("parseEncryptionKey", () => {
  it("accepts 32 bytes as hex or base64", () => {
    expect(parseEncryptionKey(key.toString("hex"))?.equals(key)).toBe(true);
    expect(parseEncryptionKey(key.toString("base64"))?.equals(key)).toBe(true);
  });

  it("rejects missing or wrong-length keys", () => {
    expect(parseEncryptionKey(undefined)).toBeNull();
    expect(parseEncryptionKey("")).toBeNull();
    expect(parseEncryptionKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseEncryptionKey("not a key")).toBeNull();
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    const enc = encryptSecret("sk-live-abc123", key);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("sk-live");
    expect(decryptSecret(enc, key)).toBe("sk-live-abc123");
  });

  it("uses a fresh IV per encryption", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("fails on a wrong key or tampered ciphertext", () => {
    const enc = encryptSecret("secret", key);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow(SettingsEncryptionError);
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 1;
    parts[3] = ct.toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow(SettingsEncryptionError);
    expect(() => decryptSecret("garbage", key)).toThrow(SettingsEncryptionError);
  });
});

describe("last4", () => {
  it("shows only the last four characters", () => {
    expect(last4("sk-1234567890")).toBe("7890");
    expect(last4("ab")).toBe("ab");
  });
});
