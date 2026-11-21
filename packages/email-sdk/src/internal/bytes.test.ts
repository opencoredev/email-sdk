import { describe, expect, test } from "bun:test";

import { attachmentToBase64, attachmentToBytes } from "../utils.js";
import { base64ToBytes, bytesToBase64, utf8ToBase64 } from "./bytes.js";

// The Web API helpers replaced Buffer, so Buffer is the oracle for what callers already relied on.
describe("Web API byte helpers match the Buffer behavior they replaced", () => {
  test("bytesToBase64 matches Buffer for every byte value and for inputs past one chunk", () => {
    const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const large = Uint8Array.from({ length: 100_003 }, (_, index) => (index * 31) % 256);

    expect(bytesToBase64(allBytes)).toBe(Buffer.from(allBytes).toString("base64"));
    expect(bytesToBase64(large)).toBe(Buffer.from(large).toString("base64"));
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });

  test("utf8ToBase64 encodes non-Latin-1 text like Buffer", () => {
    expect(utf8ToBase64("api:kéy-✓-😀")).toBe(Buffer.from("api:kéy-✓-😀").toString("base64"));
  });

  test("base64ToBytes accepts whitespace, missing padding, and URL-safe input like Buffer", () => {
    for (const value of ["aGVsbG8=", "aGVsbG8", "aGVs\nbG8=", "  aGVsbG8=  ", "-_-_", "+/+/", ""]) {
      expect([...base64ToBytes(value)]).toEqual([...Buffer.from(value, "base64")]);
    }
  });

  test("attachment helpers keep their encoded output", async () => {
    const base64 = { filename: "a.txt", content: "aMOpbGxv", contentEncoding: "base64" as const };

    expect(await attachmentToBase64({ filename: "a.txt", content: "héllo" })).toBe("aMOpbGxv");
    expect(await attachmentToBase64(base64)).toBe("aMOpbGxv");
    expect(new TextDecoder().decode(await attachmentToBytes(base64))).toBe("héllo");
    expect(await attachmentToBase64({ filename: "b", content: new Blob(["hi"]) })).toBe("aGk=");

    expect(
      await attachmentToBase64({ filename: "c", content: new Uint8Array([1, 2]).buffer }),
    ).toBe("AQI=");
  });

  test("path attachments still read from disk on Node and Bun", async () => {
    const path = new URL(import.meta.url).pathname;
    const expected = Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64");

    expect(await attachmentToBase64({ filename: "self.ts", path })).toBe(expected);
    expect(bytesToBase64(await attachmentToBytes({ filename: "self.ts", path }))).toBe(expected);
  });
});
