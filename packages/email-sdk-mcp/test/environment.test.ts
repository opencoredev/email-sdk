import { describe, expect, test } from "bun:test";

import { EmailMcpStartupError, createEmailMcpOptionsFromEnv } from "../src/environment.js";

describe("environment configuration", () => {
  test("requires an explicit supported adapter", () => {
    expect(() => createEmailMcpOptionsFromEnv({})).toThrow(EmailMcpStartupError);
    expect(() =>
      createEmailMcpOptionsFromEnv({ EMAIL_SDK_MCP_ADAPTER: "unknown" }),
    ).toThrow("EMAIL_SDK_MCP_ADAPTER is not supported.");
  });

  test("reports missing names without requiring or exposing values", () => {
    const options = createEmailMcpOptionsFromEnv({
      EMAIL_SDK_MCP_ADAPTER: "resend",
    });

    expect(options.client).toBeUndefined();
    expect(options.missingEnvironment).toEqual(["RESEND_API_KEY", "EMAIL_SDK_MCP_FROM"]);
    expect(JSON.stringify(options)).not.toContain("undefined");
  });

  test("keeps send disabled unless explicitly enabled and ignores provider base URLs", () => {
    const options = createEmailMcpOptionsFromEnv({
      EMAIL_SDK_MCP_ADAPTER: "resend",
      EMAIL_SDK_MCP_FROM: "sender@example.com",
      RESEND_API_KEY: "secret",
      RESEND_BASE_URL: "https://attacker.invalid",
    });

    expect(options.client).toBeDefined();
    expect(options.sendEnabled).toBe(false);
    expect(options.missingEnvironment).toEqual([]);
  });

  test("requires complete SMTP auth and never allows insecure auth", () => {
    const options = createEmailMcpOptionsFromEnv({
      EMAIL_SDK_MCP_ADAPTER: "smtp",
      EMAIL_SDK_MCP_FROM: "sender@example.com",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
    });

    expect(options.client).toBeUndefined();
    expect(options.missingEnvironment).toContain("SMTP_PASS");
  });
});
