import { describe, expect, test } from "bun:test";

import { gmailInbound } from "./inbound-gmail.js";

describe("gmailInbound", () => {
  test("sync lists messages with caller-managed OAuth token", async () => {
    const calls: string[] = [];
    const adapter = gmailInbound({
      accessToken: "token",
      fetch: async (input) => {
        calls.push(String(input));
        return Response.json({
          messages: [{ id: "msg_1", threadId: "thread_1" }],
        });
      },
    });

    const messages = await adapter.sync({
      since: new Date("2026-01-01T00:00:00.000Z"),
      maxResults: 10,
    });

    expect(messages).toEqual([{ id: "msg_1", threadId: "thread_1" }]);
    expect(calls[0]).toContain("maxResults=10");
    expect(calls[0]).toContain("after%3A1767225600");
  });

  test("getMessage fetches a full Gmail message", async () => {
    const adapter = gmailInbound({
      accessToken: "token",
      fetch: async (input) => {
        expect(String(input)).toContain("/messages/msg_1");
        expect(String(input)).toContain("format=full");
        return Response.json({ id: "msg_1" });
      },
    });

    await expect(adapter.getMessage("msg_1")).resolves.toEqual({ id: "msg_1" });
  });

  test("parse normalizes already-fetched Gmail message objects", async () => {
    const adapter = gmailInbound({ accessToken: "token" });
    const email = await adapter.parse(
      {
        id: "msg_1",
        payload: {
          headers: [
            { name: "From", value: "Ada <ada@example.com>" },
            { name: "To", value: "user@example.com" },
            { name: "Subject", value: "Gmail" },
            { name: "Message-ID", value: "<gmail@example.com>" },
          ],
          parts: [
            {
              mimeType: "text/plain",
              body: { data: base64Url("Hello") },
            },
            {
              mimeType: "text/html",
              body: { data: base64Url("<p>Hello</p>") },
            },
            {
              mimeType: "application/pdf",
              filename: "file.pdf",
              body: { attachmentId: "att_1", size: 12 },
            },
          ],
        },
      },
      {},
    );

    expect(email).toMatchObject({
      id: "msg_1",
      provider: "gmail",
      from: { email: "ada@example.com", name: "Ada" },
      to: [{ email: "user@example.com" }],
      subject: "Gmail",
      text: "Hello",
      html: "<p>Hello</p>",
      messageId: "<gmail@example.com>",
    });
    expect(email.attachments[0]).toMatchObject({
      filename: "file.pdf",
      contentType: "application/pdf",
      size: 12,
    });
  });
});

function base64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
