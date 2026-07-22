import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

import { createEmailMcpServer } from "../src/runtime.js";

test("stdio writes JSON-RPC only", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let stdout = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const server = createEmailMcpServer({
    adapter: "resend",
    missingEnvironment: ["RESEND_API_KEY", "EMAIL_SDK_MCP_FROM"],
  });
  await server.connect(new StdioServerTransport(input, output));

  input.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "stdio-test", version: "1.0.0" },
      },
    })}\n`,
  );
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
  );

  await waitFor(() => stdout.trim().split("\n").length >= 2);
  const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));

  expect(messages).toHaveLength(2);
  expect(messages.map(({ id }) => id).sort()).toEqual([1, 2]);
  expect(messages.every(({ jsonrpc }) => jsonrpc === "2.0")).toBe(true);
  await server.close();
});

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for stdio output.");
    }
    await Bun.sleep(5);
  }
}
