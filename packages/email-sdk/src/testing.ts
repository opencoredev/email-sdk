import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types.js";

export type MemoryEmail = {
  message: EmailMessage;
  response: EmailSendResult;
};

export type MemoryAdapter<Name extends string = string> = EmailAdapter<
  Name,
  {
    sent: MemoryEmail[];
    clear: () => void;
  }
>;

export function memoryAdapter<const Name extends string = "memory">(
  name = "memory" as Name,
): MemoryAdapter<Name> {
  const sent: MemoryEmail[] = [];

  return {
    name,
    capabilities: {
      repeatedHeaders: true,
      idempotency: "native",
      scheduling: true,
      personalized: "expanded",
    },
    raw: {
      sent,
      clear() {
        sent.length = 0;
      },
    },
    send(message) {
      const response: EmailSendResult<Name> = {
        adapter: name,
        id: `mem_${sent.length + 1}`,
      };
      sent.push({ message, response });
      return response;
    },
  };
}

export function failingAdapter<const Name extends string = "failing">(
  name = "failing" as Name,
  error: Error = new Error("Adapter failed"),
): EmailAdapter<Name> {
  return {
    name,
    capabilities: {
      repeatedHeaders: true,
      idempotency: "none",
      scheduling: true,
      personalized: "expanded",
    },
    send() {
      throw error;
    },
  };
}
