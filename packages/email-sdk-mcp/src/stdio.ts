import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createEmailMcpServer } from "./runtime.js";
import { createEmailMcpOptionsFromEnv } from "./environment.js";

export async function runEmailMcpStdio(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const server = createEmailMcpServer(createEmailMcpOptionsFromEnv(env));
  server.server.onerror = () => {
    console.error("Email SDK MCP protocol error.");
  };
  await server.connect(new StdioServerTransport());
  return server;
}
