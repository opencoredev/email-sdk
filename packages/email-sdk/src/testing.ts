import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types.js";

const TEST_ADAPTER_SEND = Symbol.for("@opencoredev/email-sdk/test-adapter-send");

/** @internal The function marker survives adapter object spread and renaming. */
export function isTestAdapter(adapter: EmailAdapter): boolean {
  return TEST_ADAPTER_SEND in adapter.send;
}

function markTestSend<T extends EmailAdapter["send"]>(send: T): T {
  Object.defineProperty(send, TEST_ADAPTER_SEND, { value: true });

  return send;
}

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
  // SAFETY: Name defaults to "memory", so the fallback matches Name whenever it is used.
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
    send: markTestSend((message) => {
      const response: EmailSendResult<Name> = {
        adapter: name,
        id: `mem_${sent.length + 1}`,
      };

      sent.push({ message, response });

      return response;
    }),
  };
}

export function failingAdapter<const Name extends string = "failing">(
  // SAFETY: Name defaults to "failing", so the fallback matches Name whenever it is used.
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
    send: markTestSend(() => {
      throw error;
    }),
  };
}
