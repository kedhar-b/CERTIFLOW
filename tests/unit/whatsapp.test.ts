import { describe, expect, it } from "vitest";
import { StubWhatsAppProvider } from "../../src/queue/whatsappProvider";

const message = {
  to: "+919999999999",
  template: "certificate_issued",
  params: { number: "CF-AAAA-BBBB-CCCC-DDDD" },
  idempotencyKey: "cert:abc:issued",
};

describe("M19 WhatsApp stub idempotency", () => {
  it("M19 sends once and deduplicates a retry with the same key", async () => {
    const provider = new StubWhatsAppProvider();
    const first = await provider.send(message);
    const retry = await provider.send(message);

    expect(first.deduplicated).toBe(false);
    expect(retry.deduplicated).toBe(true);
    expect(retry.providerMessageId).toBe(first.providerMessageId);
  });

  it("M19 treats a different key as a new message", async () => {
    const provider = new StubWhatsAppProvider();
    const first = await provider.send(message);
    const other = await provider.send({ ...message, idempotencyKey: "cert:def:issued" });
    expect(other.deduplicated).toBe(false);
    expect(other.providerMessageId).not.toBe(first.providerMessageId);
  });
});
