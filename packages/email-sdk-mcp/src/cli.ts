#!/usr/bin/env node
import { EmailMcpStartupError } from "./environment.js";
import { runEmailMcpStdio } from "./stdio.js";

if (process.argv.length > 2) {
  console.error("email-sdk-mcp does not accept command-line flags. Configure it through environment variables.");
  process.exitCode = 1;
} else {
  runEmailMcpStdio().catch((error: unknown) => {
    console.error(
      error instanceof EmailMcpStartupError
        ? error.message
        : "Email SDK MCP failed to start. Check the required environment variables.",
    );
    process.exitCode = 1;
  });
}
