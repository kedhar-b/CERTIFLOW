import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();

console.log("Paste this into backend/.env (one line, newlines escaped):\n");
console.log(`ED25519_PRIVATE_KEY_PEM="${pem.replace(/\n/g, "\\n")}"`);
