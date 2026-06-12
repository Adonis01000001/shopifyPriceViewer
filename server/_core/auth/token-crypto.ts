import crypto from "crypto";
import { ENV, ENCRYPTION_KEY_SALT } from "../env";

// Derive encryption key using PBKDF2 with a unique salt.
// This separates the encryption key from the JWT signing key,
// preventing key reuse between HMAC-SHA256 (signing) and AES-256-CBC (encryption).
function deriveEncryptionKey(): Buffer {
  const salt = ENCRYPTION_KEY_SALT || "fallback-salt-change-in-production";
  return crypto.pbkdf2Sync(
    ENV.jwtSecret || "change-me-in-production",
    salt,
    100_000,
    32,
    "sha256"
  );
}

/** Encrypt a token using AES-256-CBC with the derived key. */
export function encryptToken(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

/** Decrypt a token encrypted with encryptToken(). */
export function decryptToken(ciphertext: string): string {
  const key = deriveEncryptionKey();
  const [ivHex, encryptedHex] = ciphertext.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return decipher.update(encrypted) + decipher.final("utf8");
}
