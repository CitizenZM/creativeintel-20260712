/**
 * AES-256-GCM for secrets stored in the database (bring-your-own API keys).
 * The key comes from SETTINGS_ENCRYPTION_KEY — 32 bytes, hex or base64.
 * Stored format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const AAD = Buffer.from("creativeintel:model-provider");

export class SettingsEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsEncryptionError";
  }
}

/** 32-byte key from hex (64 chars) or base64; null when missing or malformed. */
export function parseEncryptionKey(raw: string | undefined | null): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, "hex");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return null;
  const buf = Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return buf.length === 32 ? buf : null;
}

export function settingsKeyFromEnv(): Buffer | null {
  return parseEncryptionKey(process.env.SETTINGS_ENCRYPTION_KEY);
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== VERSION || !iv || !tag || ct === undefined) {
    throw new SettingsEncryptionError("Unrecognised encrypted secret format");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SettingsEncryptionError(
      "Could not decrypt the secret — SETTINGS_ENCRYPTION_KEY changed or the value was tampered with"
    );
  }
}

/** What the UI may show of a key. */
export function last4(secret: string): string {
  return secret.slice(-4);
}
