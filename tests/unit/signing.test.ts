import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_NUMBER_PATTERN,
  generateCertificateNumber,
  maskName,
  signCertificate,
  verifyCertificateSignature,
} from "../../src/lib/signing";

const payload = { id: "11111111-1111-4111-8111-111111111111", number: "CF-AAAA-BBBB-CCCC-DDDD", course: "Welding", issueDate: "2026-11-21" };

describe("M01 certificate numbers", () => {
  it("M01 matches the CF-XXXX-XXXX-XXXX-XXXX format", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateCertificateNumber()).toMatch(CERTIFICATE_NUMBER_PATTERN);
    }
  });

  it("M01 does not repeat across many draws", () => {
    const numbers = new Set(Array.from({ length: 5000 }, () => generateCertificateNumber()));
    expect(numbers.size).toBe(5000);
  });
});

describe("M02 Ed25519 signing", () => {
  it("M02 verifies an untouched payload", () => {
    expect(verifyCertificateSignature(payload, signCertificate(payload))).toBe(true);
  });

  it("M02 fails when any signed field changes", () => {
    const signature = signCertificate(payload);
    expect(verifyCertificateSignature({ ...payload, course: "Plumbing" }, signature)).toBe(false);
    expect(verifyCertificateSignature({ ...payload, number: "CF-0000-0000-0000-0000" }, signature)).toBe(false);
    expect(verifyCertificateSignature({ ...payload, issueDate: "2026-11-22" }, signature)).toBe(false);
  });

  it("M02 is not affected by the order the fields are written in", () => {
    const reordered = { issueDate: payload.issueDate, course: payload.course, number: payload.number, id: payload.id };
    expect(verifyCertificateSignature(reordered, signCertificate(payload))).toBe(true);
  });

  it("M02 signs only id, number, course and issueDate", () => {
    const withPersonalData = { ...payload, name: "Ravi Kumar", phone: "+919999999999", email: "r@example.com" };
    // Extra fields are ignored by the signer, so personal data can never end up in the signed bytes.
    expect(verifyCertificateSignature(payload, signCertificate(withPersonalData))).toBe(true);
  });
});

describe("M03 name masking", () => {
  it("M03 keeps only the first letter of each word", () => {
    expect(maskName("Ravi Kumar")).toBe("R*** K***");
    expect(maskName("  Anitha   Devi Reddy ")).toBe("A*** D*** R***");
  });

  it("M03 never leaks the rest of the name", () => {
    expect(maskName("Ravi Kumar")).not.toContain("avi");
  });
});
