import { EmailValidationError } from "./errors.js";
import type { EmailPlugin } from "./types.js";

export type EmailTimeoutPluginOptions = {
  timeoutMs: number;
  id?: string;
};

export function timeoutPlugin(options: EmailTimeoutPluginOptions): EmailPlugin {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new EmailValidationError("timeoutPlugin timeoutMs must be a positive finite number.");
  }

  return {
    id: options.id ?? "timeout",
    middleware: [
      {
        beforeSend(event) {
          const timeout = AbortSignal.timeout(options.timeoutMs);
          const signal = event.options?.signal
            ? AbortSignal.any([event.options.signal, timeout])
            : timeout;

          return {
            options: {
              ...event.options,
              signal,
            },
          };
        },
      },
    ],
  };
}
