import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "crypto";

const APP_KEY_ENV = "APP_KEY";
const APP_KEY_MIN_LENGTH = 32;
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_PREFIX = "cliparr:enc:v1";
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_KEY_BYTES = 32;
const ENCRYPTION_SALT = "cliparr-persisted-secrets";
const SECRET_FIELD_NAMES = new Set(["accessToken", "refreshToken", "password", "apiKey", "token"]);

let encryptionKey: Buffer | undefined;

function appKeyError(message: string) {
  return new Error(`${APP_KEY_ENV} ${message}`);
}

function getConfiguredAppKey() {
  const appKey = process.env[APP_KEY_ENV]?.trim();
  if (!appKey) {
    throw appKeyError("is required so Cliparr can encrypt persisted provider credentials.");
  }

  if (appKey.length < APP_KEY_MIN_LENGTH) {
    throw appKeyError(`must be at least ${APP_KEY_MIN_LENGTH} characters long.`);
  }

  return appKey;
}

function getEncryptionKey() {
  if (!encryptionKey) {
    encryptionKey = scryptSync(getConfiguredAppKey(), ENCRYPTION_SALT, ENCRYPTION_KEY_BYTES);
  }

  return encryptionKey;
}

export function assertAppKeyConfigured() {
  getEncryptionKey();
}

export function isEncryptedSecret(value: string) {
  return value.startsWith(`${ENCRYPTION_PREFIX}:`);
}

export function encryptSecret(value: string) {
  if (!value || isEncryptedSecret(value)) {
    return value;
  }

  const iv = randomBytes(ENCRYPTION_IV_BYTES);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTION_PREFIX}:${iv.toString("base64url")}:${authTag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  if (!value || !isEncryptedSecret(value)) {
    return value;
  }

  const [, , , ivBase64, authTagBase64, ciphertextBase64] = value.split(":");
  if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new Error("Stored secret has an invalid encryption format.");
  }

  try {
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      getEncryptionKey(),
      Buffer.from(ivBase64, "base64url")
    );
    decipher.setAuthTag(Buffer.from(authTagBase64, "base64url"));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextBase64, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw new Error(
      `Stored secrets could not be decrypted. Verify ${APP_KEY_ENV} matches the key previously used for this data directory.`,
      { cause: err }
    );
  }
}

export function hashSecret(value: string) {
  return createHmac("sha256", getEncryptionKey()).update(value).digest("hex");
}

function transformSecretFields(value: unknown, transform: (secret: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformSecretFields(item, transform));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, childValue]) => {
        if (SECRET_FIELD_NAMES.has(key) && typeof childValue === "string") {
          return [key, transform(childValue)];
        }

        return [key, transformSecretFields(childValue, transform)];
      })
    );
  }

  return value;
}

export function encryptJsonSecrets<T>(value: T): T {
  return transformSecretFields(value, encryptSecret) as T;
}

export function decryptJsonSecrets<T>(value: T): T {
  return transformSecretFields(value, decryptSecret) as T;
}
