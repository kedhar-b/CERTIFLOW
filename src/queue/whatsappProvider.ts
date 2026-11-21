import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";

export interface WhatsAppMessage {
  to: string;
  template: string;
  params: Record<string, string>;
  idempotencyKey: string;
}

export interface WhatsAppProvider {
  send(message: WhatsAppMessage): Promise<{ providerMessageId: string; deduplicated: boolean }>;
}

function maskPhone(phone: string): string {
  return phone.length <= 4 ? "****" : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}

/** Stand-in for the real provider. Same idempotency-key contract a real one would offer. */
export class StubWhatsAppProvider implements WhatsAppProvider {
  private readonly sent = new Map<string, string>();

  async send(message: WhatsAppMessage) {
    const previous = this.sent.get(message.idempotencyKey);
    if (previous) return { providerMessageId: previous, deduplicated: true };

    const providerMessageId = `stub-${randomUUID()}`;
    this.sent.set(message.idempotencyKey, providerMessageId);
    logger.info("whatsapp stub: message sent", {
      to: maskPhone(message.to),
      template: message.template,
      idempotencyKey: message.idempotencyKey,
    });
    return { providerMessageId, deduplicated: false };
  }
}

export const whatsappProvider: WhatsAppProvider = new StubWhatsAppProvider();
