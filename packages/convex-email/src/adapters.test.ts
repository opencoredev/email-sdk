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
  adapterFields,
  isConvexEmailAdapterKind,
  type ConvexEmailAdapterKind,
} from "./shared/adapters.js";
import type { ConvexEmailAdapterConfig } from "./shared/types.js";

// Values that satisfy every registry field type, so each adapter can be constructed from the
// component environment alone.
const ENV_FIXTURES = new Map([
  ["ITERABLE_CAMPAIGN_ID", "4242"],
  ["SMTP_PORT", "2525"],
  ["SMTP_SECURE", "false"],
]);

function envFixture(name: string) {
  return ENV_FIXTURES.get(name) ?? `${name.toLowerCase()}-value`;
}

function registryEntries() {
  return CONVEX_EMAIL_ADAPTER_KINDS.map((kind) => [kind, adapterFields(kind) ?? {}] as const);
}

/** The minimal config for a kind: every field besides `kind` is optional. */
function bareConfig(kind: ConvexEmailAdapterKind): ConvexEmailAdapterConfig {
  // SAFETY: every adapter config type is `{ kind }` plus optional env-override and inline keys
  // (see ConvexEmailAdapterConfigFor), so `{ kind }` is a valid config for each member of the union.
  // TypeScript cannot distribute the literal over a union this large, which is the only reason for
  // the assertion.
  return { kind } as ConvexEmailAdapterConfig;
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
    const builtIn = Object.keys(SUPPORTED_MESSAGE_FIELDS).filter(isConvexEmailAdapterKind).sort();

    expect(builtIn).toHaveLength(Object.keys(SUPPORTED_MESSAGE_FIELDS).length);
    expect(configurable).toEqual(builtIn);
  });

  test("includes Lettermint with its documented environment variables", () => {
    expect(CONVEX_EMAIL_ADAPTERS.lettermint).toEqual({
      apiToken: { type: "string", env: "LETTERMINT_API_TOKEN", required: true },
      route: { type: "string", env: "LETTERMINT_ROUTE", inline: true },
      baseUrl: { type: "string", inline: true },
    });
  });

  test("includes Lettr with its documented environment variables", () => {
    expect(CONVEX_EMAIL_ADAPTERS.lettr).toEqual({
      apiKey: { type: "string", env: "LETTR_API_KEY", required: true },
      baseUrl: { type: "string", inline: true },
    });
  });

  test("never allows a credential to be stored inline", () => {
    const credentials = /token|key|secret|pass/i;
    const inlineCredentials: string[] = [];

    for (const [kind, fields] of registryEntries()) {
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

    for (const [kind, fields] of registryEntries()) {
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
      expect(() => buildEmailClient({ adapters: [bareConfig(kind)] })).not.toThrow();
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

  test("Graph endpoints and scope can only come from server environment", () => {
    setRegistryEnv();
    process.env.MS_GRAPH_BASE_URL = "https://graph.microsoft.us/v1.0";
    process.env.MS_GRAPH_TOKEN_URL = "https://login.microsoftonline.us/tenant/oauth2/v2.0/token";
    process.env.MS_GRAPH_SCOPE = "https://graph.microsoft.us/.default";

    // A config that bypassed the component validator: Graph has no inline endpoint fields.
    const smuggled = Object.assign(
      { kind: "graph" as const },
      { baseUrl: "https://attacker.invalid", tokenUrl: "https://attacker.invalid/token", scope: "untrusted" },
    );

    const options = resolveAdapterOptions(smuggled);

    expect(options.baseUrl).toBe(process.env.MS_GRAPH_BASE_URL);
    expect(options.tokenUrl).toBe(process.env.MS_GRAPH_TOKEN_URL);
    expect(options.scope).toBe(process.env.MS_GRAPH_SCOPE);

    for (const key of ["baseUrl", "tokenUrl", "scope"] as const) {
      expect("inline" in CONVEX_EMAIL_ADAPTERS.graph[key]).toBe(false);
    }
  });

  test("Graph secrets cannot be read through another adapter or a URL field", () => {
    setRegistryEnv();

    const graphSecret = process.env.MS_GRAPH_CLIENT_SECRET ?? "";

    const crossAdapterConfigs: ConvexEmailAdapterConfig[] = [
      { kind: "resend", apiKeyEnv: "MS_GRAPH_CLIENT_SECRET", baseUrl: "https://attacker.invalid" },
      { kind: "smtp", passEnv: "MS_GRAPH_CLIENT_SECRET", host: "attacker.invalid" },
    ];

    for (const config of crossAdapterConfigs) {
      expect(() => resolveAdapterOptions(config)).toThrow("restricted to graph.clientSecret");
      expect(() => resolveAdapterOptions(config)).not.toThrow(graphSecret);
    }

    const graphEnvFields = ["baseUrlEnv", "tokenUrlEnv", "userEnv", "scopeEnv", "tenantIdEnv", "clientIdEnv"] as const;

    for (const field of graphEnvFields) {
      for (const source of ["MS_GRAPH_CLIENT_SECRET", "RESEND_API_KEY"] as const) {
        const config: ConvexEmailAdapterConfig = { kind: "graph", [field]: source };

        expect(() => resolveAdapterOptions(config)).toThrow(`Graph ${field} must use`);
        expect(() => resolveAdapterOptions(config)).not.toThrow(process.env[source] ?? "");
      }
    }

    expect(resolveAdapterOptions({ kind: "graph", clientSecretEnv: "MS_GRAPH_CLIENT_SECRET" })
      .clientSecret).toBe(process.env.MS_GRAPH_CLIENT_SECRET);
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

  test("does not recognise an unknown adapter kind", () => {
    expect(isConvexEmailAdapterKind("owl-post")).toBe(false);
    expect(adapterFields("owl-post")).toBeUndefined();
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

  test("rejects attacker-controlled Graph endpoints in owned sends and batches", async () => {
    const t = convexTest(schema, modules);

    for (const field of ["baseUrl", "tokenUrl", "scope"]) {
      // The generated API accepts any args, so this reaches the component validator unchanged.
      const email = {
        ...message,
        adapters: [{ kind: "graph", [field]: "https://attacker.invalid" }],
        adapter: "graph",
      };

      await expect(t.mutation(api.lib.enqueueOwned, {
        email, ownerId: "authenticated-user",
      })).rejects.toThrow("Validator error");
      await expect(t.mutation(api.lib.enqueueOwnedBatch, {
        messages: [email], ownerId: "authenticated-user",
      })).rejects.toThrow("Validator error");
    }
  });

  test("rejects an unknown adapter kind at the component boundary", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.enqueue, { ...message, adapters: [{ kind: "owl-post" }], adapter: "owl-post" }),
    ).rejects.toThrow("Validator error");
  });

  test("rejects an inline credential", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.mutation(api.lib.enqueue, {
        ...message,
        adapters: [{ kind: "lettermint", apiToken: "lm_live_123" }],
        adapter: "lettermint",
      }),
    ).rejects.toThrow("Validator error");
  });
});
