import { describe, expect, test } from "bun:test";

import { EmailValidationError } from "./errors.js";
import { smtp } from "./smtp.js";
import type { EmailMessage } from "./types.js";

const baseMessage: EmailMessage = {
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Hello",
  text: "Hi there",
};

function send(message: EmailMessage) {
  // host points at an unroutable port; validation must reject before any connect.
  return smtp({ host: "127.0.0.1", port: 1 }).send(message, { attempt: 1 });
}

describe("smtp injection guards", () => {
  test("rejects CRLF injected into the envelope address", async () => {
    await expect(
      send({ ...baseMessage, to: "victim@example.com\r\nRCPT TO:evil@example.com" }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("rejects whitespace and angle brackets in the envelope address", async () => {
    await expect(
      send({ ...baseMessage, from: "attacker@example.com> evil" }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("rejects a CRLF injected header name", async () => {
    await expect(
      send({
        ...baseMessage,
        headers: { "X-Trace\r\nBcc: hidden@evil.com": "1" },
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("rejects a colon in a header name", async () => {
    await expect(
      send({ ...baseMessage, headers: [{ name: "X-Bad: Injected", value: "1" }] }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("rejects DEL and non-ASCII characters in the envelope address", async () => {
    await expect(send({ ...baseMessage, to: "victim\x7f@example.com" })).rejects.toBeInstanceOf(
      EmailValidationError,
    );
    await expect(send({ ...baseMessage, to: "víctim@example.com" })).rejects.toBeInstanceOf(
      EmailValidationError,
    );
  });

  test("bare CR in a header value does not survive folding as an injection vector", async () => {
    // foldHeader must neutralise lone \r so it cannot be used as a line separator
    await expect(
      send({ ...baseMessage, headers: { "X-Custom": "legit\rBcc: evil@example.com" } }),
    ).rejects.not.toBeInstanceOf(EmailValidationError);
  });

  test("accepts addresses with hyphens and plus signs", async () => {
    // A valid message should pass validation and fail later at the network layer,
    // never with a validation error.
    await expect(
      send({
        ...baseMessage,
        from: "no-reply+tag@my-domain.example.com",
        to: "user.name+tag@sub-domain.example.com",
      }),
    ).rejects.not.toBeInstanceOf(EmailValidationError);
  });
});
