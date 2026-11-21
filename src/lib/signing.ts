import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { config } from "../config";
import { logger } from "./logger";

/** The only fields that are ever signed. No name, phone or email. */
export interface SignedCertificatePayload {
  id: string;
  number: string;
  course: string;
  issueDate: string; // YYYY-MM-DD
}

interface KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

let cachedKeys: KeyPair | undefined;

function loadKeys(): KeyPair {
  if (cachedKeys) return cachedKeys;

  if (config.ED25519_PRIVATE_KEY_PEM) {
    const privateKey = createPrivateKey(config.ED25519_PRIVATE_KEY_PEM.replace(/\\n/g, "\n"));
    cachedKeys = { privateKey, publicKey: createPublicKey(privateKey) };
    return cachedKeys;
  }

  if (config.NODE_ENV === "production") {
    throw new Error("ED25519_PRIVATE_KEY_PEM must be set in production");
  }

  logger.warn("ED25519_PRIVATE_KEY_PEM not set; using an ephemeral key. Signatures will not survive a restart.");
  cachedKeys = generateKeyPairSync("ed25519");
  return cachedKeys;
}

// Fixed key order so the signed bytes are identical on every machine.
function canonicalBytes(payload: SignedCertificatePayload): Buffer {
  return Buffer.from(
    JSON.stringify({ id: payload.id, number: payload.number, course: payload.course, issueDate: payload.issueDate }),
    "utf8",
  );
}

export function signCertificate(payload: SignedCertificatePayload): string {
  return sign(null, canonicalBytes(payload), loadKeys().privateKey).toString("base64");
}

export function verifyCertificateSignature(payload: SignedCertificatePayload, signatureBase64: string): boolean {
  return verify(null, canonicalBytes(payload), loadKeys().publicKey, Buffer.from(signatureBase64, "base64"));
}

export function publicKeyPem(): string {
  return loadKeys().publicKey.export({ type: "spki", format: "pem" }).toString();
}

export const CERTIFICATE_NUMBER_PATTERN = /^CF-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

/** 64 random bits from the OS CSPRNG, formatted as CF-XXXX-XXXX-XXXX-XXXX. */
export function generateCertificateNumber(): string {
  const hex = randomBytes(8).toString("hex").toUpperCase();
  return `CF-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

/** "Ravi Kumar" -> "R*** K***" */
export function maskName(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${Array.from(part)[0] ?? ""}***`)
    .join(" ");
}
