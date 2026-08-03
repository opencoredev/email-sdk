import { SUPPORTED_MESSAGE_FIELDS } from "@opencoredev/email-sdk";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";

import { api } from "./component/_generated/api.js";
import { buildEmailClient, resolveAdapterOptions } from "./component/providers.js";
import schema from "./component/schema.js";
import { modules } from "./testing.js";
import {
  CONVEX_EMAIL_ADAPTER_KINDS,
  CONVEX_EMAIL_ADAPTERS,
  CONVEX_EMAIL_ENV_VARS,
  type ConvexAdapterFields,
} from "./shared/adapters.js";
import type { ConvexEmailAdapterConfig } from "./shared/types.js";

// Values that satisfy every registry field type, so each adapter can be constructed from the
// component environment alone.
const ENV_FIXTURES: Record<string, string> = {
  ITERABLE_CAMPAIGN_ID: "4242",
  SMTP_PORT: "2525",
  SMTP_SECURE: "false",
};

function envFixture(name: string) {
  return ENV_FIXTURES[name] ?? `${name.toLowerCase()}-value`;
}

function setRegistryEnv() {
  for (const name of CONVEX_EMAIL_ENV_VARS) {
    process.env[name] = envFixture(name);
  }
}

function clearRegistryEnv() {
  for (const name of CONVEX_EMAIL_ENV_VARS) {
    delete process.env[name];
  }
}

describe("adapter registry", () => {
  beforeEach(clearRegistryEnv);
  afterEach(clearRegistryEnv);

  test("covers every built-in Email SDK adapter", () => {
    const configurable = CONVEX_EMAIL_ADAPTER_KINDS.filter((kind) => kind !== "memory").sort();
    const builtIn = Object.keys(SUPPORTED_MESSAGE_FIELDS).sort();

    expect(configurable).toEqual(builtIn as typeof configurable);
  });

  test("includes Lettermint with its documented environment variables", () => {
    expect(CONVEX_EMAIL_ADAPTERS.lettermint).toEqual({
      apiToken: { type: "string", env: "LETTERMINT_API_TOKEN", required: true },
      route: { type: "string", env: "LETTERMINT_ROUTE", inline: true },
      baseUrl: { type: "string", inline: true },
    });
  });

  test("never allows a credential to be stored inline", () => {
    const credentials = /token|key|secret|pass/i;
    const inlineCredentials: string[] = [];

    for (const [kind, fields] of Object.entries(
      CONVEX_EMAIL_ADAPTERS as Record<string, ConvexAdapterFields>,
    )) {
      for (const [key, field] of Object.entries(fields)) {
        if (field.inline && credentials.test(key)) {
          inlineCredentials.push(`${kind}.${key}`);
        }
      }
    }

    expect(inlineCredentials).toEqual([]);
  });

  test("only resolves record fields inline, because environment values are strings", () => {
    const fromEnv: string[] = [];

    for (const [kind, fields] of Object.entries(
      CONVEX_EMAIL_ADAPTERS as Record<string, ConvexAdapterFields>,
    )) {
      for (const [key, field] of Object.entries(fields)) {
        if (field.type === "record" && field.env) {
          fromEnv.push(`${kind}.${key}`);
        }
      }
    }

    expect(fromEnv).toEqual([]);
  });

  test("builds every adapter from its default environment variables", () => {
    setRegistryEnv();

    for (const kind of CONVEX_EMAIL_ADAPTER_KINDS) {
      const config = { kind } as ConvexEmailAdapterConfig;

      expect(() => buildEmailClient({ adapters: [config] })).not.toThrow();
    }
  });
});

describe("adapter option resolution", () => {
  beforeEach(clearRegistryEnv);
  afterEach(clearRegistryEnv);

  test("reads required credentials from the default environment variable", () => {
    process.env.LETTERMINT_API_TOKEN = "lm_live_123";

    expect(resolveAdapterOptions({ kind: "lettermint" })).toEqual({ apiToken: "lm_live_123" });
  });

  test("reports the missing variable by name", () => {
    expect(() => resolveAdapterOptions({ kind: "lettermint" })).toThrow(
      "Missing Convex Email component environment variable LETTERMINT_API_TOKEN.",
    );
  });

  test("honours an override that names another declared variable", () => {
    process.env.LETTERMINT_API_TOKEN = "lettermint-token";
    process.env.JETEMAIL_API_KEY = "jetemail-token";

    expect(
      resolveAdapterOptions({
        kind: "lettermint",
        name: "lettermint-secondary",
        apiTokenEnv: "JETEMAIL_API_KEY",
      }),
    ).toEqual({ apiToken: "jetemail-token" });
  });

  test("rejects an override naming a variable the component never receives", () => {
    process.env.LETTERMINT_API_TOKEN = "lettermint-token";
    process.env.LETTERMINT_BROADCAST_TOKEN = "broadcast-token";

    // The variable exists in this process, but a deployed component would never see it, so
    // resolving it here would hide a configuration that cannot work in production.
    expect(() =>
      resolveAdapterOptions({
        kind: "lettermint",
        apiTokenEnv: "LETTERMINT_BROADCAST_TOKEN",
      }),
    ).toThrow(
      'Convex Email adapter "lettermint" cannot read environment variable LETTERMINT_BROADCAST_TOKEN',
    );

    delete process.env.LETTERMINT_BROADCAST_TOKEN;
  });

  test("prefers an inline value over the environment", () => {
    process.env.LETTERMINT_API_TOKEN = "lm_live_123";
    process.env.LETTERMINT_ROUTE = "from-env";

    expect(resolveAdapterOptions({ kind: "lettermint", route: "transactional" })).toEqual({
      apiToken: "lm_live_123",
      route: "transactional",
    });
  });

  test("omits optional fields that neither config nor environment supplies", () => {
    process.env.LETTERMINT_API_TOKEN = "lm_live_123";

    expect(resolveAdapterOptions({ kind: "lettermint" })).not.toHaveProperty("route");
  });

  test("coerces numeric and boolean environment values", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_SECURE = "true";

    expect(resolveAdapterOptions({ kind: "smtp" })).toEqual({
      host: "smtp.example.test",
      port: 2525,
      secure: true,
    });
  });

  test("rejects a non-numeric value for a numeric field", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "not-a-port";

    expect(() => resolveAdapterOptions({ kind: "smtp" })).toThrow(
      "Convex environment variable SMTP_PORT must be a number.",
    );
  });

  test("rejects an unknown adapter kind", () => {
    expect(() =>
      resolveAdapterOptions({ kind: "owl-post" } as unknown as ConvexEmailAdapterConfig),
    ).toThrow('Unknown Convex Email adapter kind "owl-post".');
  });
});

describe("adapter config wire format", () => {
  const message = {
    from: "Acme <hello@example.com>",
    to: "ada@example.com",
    subject: "Welcome",
    text: "Your account is ready.",
  };

  test("accepts a generated adapter config across the component boundary", async () => {
    const t = convexTest(schema, modules);

    const emailId = await t.mutation(api.lib.enqueue, {
      ...message,
      adapters: [
        { kind: "lettermint", name: "lettermint-transactional", route: "transactional" },
        { kind: "jetemail", apiKeyEnv: "PLUNK_API_KEY" },
        { kind: "primitive", baseUrl: "https://primitive.example.test" },
      ],
      adapter: "lettermint-transactional",
      maxAttempts: 1,
    });

    const status = await t.query(api.lib.status, { emailId });

    expect(status?.adapters).toEqual([
      { kind: "lettermint", name: "lettermint-transactional", route: "transactional" },
      { kind: "jetemail", apiKeyEnv: "PLUNK_API_KEY" },
      { kind: "primitive", baseUrl: "https://primitive.example.test" },
    ]);
  });

  test("rejects an inline credential", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.enqueue, {
        ...message,
        adapters: [{ kind: "lettermint", apiToken: "lm_live_123" } as ConvexEmailAdapterConfig],
        adapter: "lettermint",
      }),
    ).rejects.toThrow("Validator error");
  });
});
