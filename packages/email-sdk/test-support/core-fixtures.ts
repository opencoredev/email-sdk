import type { EmailAdapter, EmailMessage } from "../src/types.js";
import type { Telemetry, TelemetryEventName, TelemetryProperties } from "../src/telemetry.js";

export const message: EmailMessage = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello there",
};

export const capabilities = {
  repeatedHeaders: true,
  idempotency: "native" as const,
  scheduling: true,
  personalized: "expanded" as const,
};

export function adapter<const Name extends string>(
  name: Name,
  send: EmailAdapter<Name>["send"] = () => ({ adapter: name, id: `${name}_1` }),
  overrides: Partial<EmailAdapter<Name>> = {},
): EmailAdapter<Name> {
  return { name, capabilities, send, ...overrides };
}

export function telemetryCapture() {
  const events: Array<{ event: TelemetryEventName; properties?: TelemetryProperties }> = [];
  const exceptions: unknown[] = [];

  const telemetry: Telemetry = {
    enabled: true,
    async capture(event, properties) {
      events.push({ event, properties });
    },
    async captureException(error) {
      exceptions.push(error);
    },
    async flush() {},
  };

  return { events, exceptions, telemetry };
}

export function emailAddressOfTest(value: EmailMessage["to"]): string {
  const [first] = [value].flat();

  if (first === undefined) throw new Error("Expected at least one recipient.");

  return first instanceof Object ? first.email : first;
}
