import type { EmailMessage, EmailProvider, EmailProviderResponse } from "./types.js";

export type MemoryEmail = {
  message: EmailMessage;
  response: EmailProviderResponse;
};

export type MemoryProvider = EmailProvider<{
  sent: MemoryEmail[];
  clear: () => void;
}>;

export function memoryProvider(name = "memory"): MemoryProvider {
  const sent: MemoryEmail[] = [];

  return {
    name,
    raw: {
      sent,
      clear() {
        sent.length = 0;
      },
    },
    send(message) {
      const response = {
        provider: name,
        id: `mem_${sent.length + 1}`,
        messageId: `mem_${sent.length + 1}`,
      };

      sent.push({ message, response });

      return response;
    },
  };
}

export function failingProvider(
  name = "failing",
  error: Error = new Error("Provider failed"),
): EmailProvider {
  return {
    name,
    send() {
      throw error;
    },
  };
}
