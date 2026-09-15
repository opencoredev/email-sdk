import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function base64(value: string) {
  return Buffer.from(value).toString("base64");
}

// Runs a minimal in-process SMTP server, sends the message through the adapter,
// and returns the raw DATA payload the client transmitted.
async function captureSmtpData(message: EmailMessage) {
  let captured = "";
  let inData = false;
  const commands: string[] = [];

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 test.local\r\n");
    socket.on("data", (chunk: string) => {
      if (inData) {
        captured += chunk;

        if (captured.endsWith("\r\n.\r\n")) {
          inData = false;
          socket.write("250 queued as test-id\r\n");
        }

        return;
      }

      const command = chunk.trim().toUpperCase();
      commands.push(command);

      if (command.startsWith("EHLO")) {
        socket.write("250 test.local\r\n");
      } else if (command.startsWith("MAIL") || command.startsWith("RCPT")) {
        socket.write("250 ok\r\n");
      } else if (command === "DATA") {
        inData = true;
        socket.write("354 go ahead\r\n");
      } else if (command === "QUIT") {
        socket.write("221 bye\r\n");
        socket.end();
      } else {
        socket.write("250 ok\r\n");
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;

  try {
    await smtp({ host: "127.0.0.1", port }).send(message, { attempt: 1 });
  } finally {
    server.close();
  }

  return { commands, data: captured };
}

describe("smtp attachments", () => {
  test("sends text messages with attachment MIME parts", async () => {
    const transmitted = await captureSmtpData({
      ...baseMessage,
      attachments: [{ filename: "hello.txt", content: "hello", contentType: "text/plain" }],
    });

    expect(transmitted.data).toContain('Content-Type: multipart/mixed; boundary="email-sdk-mixed-');
    expect(transmitted.data).toContain("Content-Type: text/plain; charset=utf-8");
    expect(transmitted.data).toContain('Content-Type: text/plain; name="hello.txt"');
    expect(transmitted.data).toContain("Content-Transfer-Encoding: base64");
    expect(transmitted.data).toContain('Content-Disposition: attachment; filename="hello.txt"');
    expect(transmitted.data).toContain(base64("hello"));
  });

  test("sends html-only messages with attachment MIME parts", async () => {
    const transmitted = await captureSmtpData({
      ...baseMessage,
      text: undefined,
      html: "<p>Hi there</p>",
      attachments: [{ filename: "hello.txt", content: "hello" }],
    });

    expect(transmitted.data).toContain('Content-Type: multipart/mixed; boundary="email-sdk-mixed-');
    expect(transmitted.data).toContain("Content-Type: text/html; charset=utf-8");
    expect(transmitted.data).toContain('Content-Type: application/octet-stream; name="hello.txt"');
    expect(transmitted.data).not.toContain("multipart/alternative");
  });

  test("nests alternative bodies inside mixed messages", async () => {
    const transmitted = await captureSmtpData({
      ...baseMessage,
      html: "<p>Hi there</p>",
      attachments: [{ filename: "hello.txt", content: "hello" }],
    });

    expect(transmitted.data).toContain("Content-Type: multipart/mixed");
    expect(transmitted.data).toContain("Content-Type: multipart/alternative");
    expect(transmitted.data).toContain("Content-Type: text/plain; charset=utf-8");
    expect(transmitted.data).toContain("Content-Type: text/html; charset=utf-8");
  });

  test("encodes raw, base64, byte, and file attachments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "email-sdk-smtp-"));
    const path = join(dir, "from-file.txt");

    try {
      await writeFile(path, "from file");
      const alreadyEncoded = base64("already encoded");
      const transmitted = await captureSmtpData({
        ...baseMessage,
        attachments: [
          { filename: "raw.txt", content: "raw text" },
          { filename: "base64.txt", content: alreadyEncoded, contentEncoding: "base64" },
          { filename: "bytes.bin", content: new Uint8Array([1, 2, 3]) },
          { filename: "from-file.txt", path, contentType: "text/plain" },
        ],
      });

      expect(transmitted.data).toContain(base64("raw text"));
      expect(transmitted.data).toContain(alreadyEncoded);
      expect(transmitted.data).toContain(Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"));
      expect(transmitted.data).toContain(base64("from file"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reads file attachments before connecting", async () => {
    await expect(
      send({
        ...baseMessage,
        attachments: [{ filename: "missing.txt", path: join(tmpdir(), "missing-email-sdk.txt") }],
      }),
    ).rejects.toHaveProperty("code", "ENOENT");
  });

  test("sends inline content IDs", async () => {
    const transmitted = await captureSmtpData({
      ...baseMessage,
      html: '<img src="cid:logo" alt="Logo" />',
      attachments: [
        {
          filename: "logo.png",
          content: new Uint8Array([137, 80, 78, 71]),
          contentType: "image/png",
          contentId: "logo",
          disposition: "inline",
        },
      ],
    });

    expect(transmitted.data).toContain('Content-Disposition: inline; filename="logo.png"');
    expect(transmitted.data).toContain("Content-ID: <logo>");
  });
});

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

  test("rejects custom Bcc headers case-insensitively before connecting", async () => {
    for (const name of ["Bcc", "bcc", "BCC"] as const) {
      await expect(
        send({ ...baseMessage, headers: [{ name, value: "hidden@example.com" }] }),
      ).rejects.toBeInstanceOf(EmailValidationError);
    }
  });

  test("rejects DEL and non-ASCII characters in the envelope address", async () => {
    await expect(send({ ...baseMessage, to: "victim\x7f@example.com" })).rejects.toBeInstanceOf(
      EmailValidationError,
    );
    await expect(send({ ...baseMessage, to: "víctim@example.com" })).rejects.toBeInstanceOf(
      EmailValidationError,
    );
  });

  test("bare CR in a header value is folded before transmission", async () => {
    const transmitted = await captureSmtpData({
      ...baseMessage,
      headers: { "X-Custom": "legit\rBcc: evil@example.com" },
    });

    // The lone \r is folded into a space, so the value stays on one header line
    // and no injected Bcc header reaches the wire.
    expect(transmitted.data).toContain("X-Custom: legit Bcc: evil@example.com");
    const injected = transmitted.data
      .split(/\r\n|[\r\n]/)
      .some((line) => line.toLowerCase().startsWith("bcc:"));
    expect(injected).toBe(false);
  });

  test("preserves repeated header names on the wire", async () => {
    const transmitted = await captureSmtpData({
      ...baseMessage,
      headers: [
        { name: "X-Trace", value: "one" },
        { name: "X-Trace", value: "two" },
      ],
    });

    expect(transmitted.data.match(/^X-Trace:/gim)).toHaveLength(2);
    expect(transmitted.data).toContain("X-Trace: one");
    expect(transmitted.data).toContain("X-Trace: two");
  });

  test("omits Bcc from DATA while sending all recipients as RCPT", async () => {
    const transmitted = await captureSmtpData({
      ...baseMessage,
      to: ["to@example.com"],
      cc: "cc@example.com",
      bcc: ["bcc@example.com"],
    });

    expect(transmitted.commands).toContain("RCPT TO:<TO@EXAMPLE.COM>");
    expect(transmitted.commands).toContain("RCPT TO:<CC@EXAMPLE.COM>");
    expect(transmitted.commands).toContain("RCPT TO:<BCC@EXAMPLE.COM>");
    const dataHeaderLines = transmitted.data.split(/\r\n\r\n/)[0]?.split(/\r\n|[\r\n]/) ?? [];
    expect(dataHeaderLines.some((line) => line.toLowerCase().startsWith("bcc:"))).toBe(false);
  });

  test.each([
    ["filename", { filename: 'bad"name.txt', content: "hello" }, "SMTP attachment filename"],
    ["filename type", { filename: 123, content: "hello" }, "SMTP attachment filename"],
    [
      "content type",
      { filename: "hello.txt", content: "hello", contentType: "text/plain; charset=utf-8" },
      "SMTP attachment content type",
    ],
    [
      "content ID",
      { filename: "hello.txt", content: "hello", contentId: "bad id" },
      "SMTP attachment content ID",
    ],
    [
      "disposition",
      { filename: "hello.txt", content: "hello", disposition: "inline\r\nBcc: bad" },
      "SMTP attachment disposition",
    ],
  ])("rejects unsafe attachment %s", async (_, attachment, message) => {
    await expect(send({ ...baseMessage, attachments: [attachment as never] })).rejects.toThrow(
      message,
    );
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
