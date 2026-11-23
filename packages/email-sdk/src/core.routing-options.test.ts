import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { EmailAdapterError, EmailRouteError } from "./errors.js";
import type { EmailAdapter } from "./types.js";
import { adapter, message } from "../test-support/core-fixtures.js";

function rejecting<const Name extends string>(name: Name, attempts: string[]) {
  return adapter(name, () => {
    attempts.push(name);

    throw new EmailAdapterError(`${name} rejected`, { adapter: name, delivery: "not_sent" });
  });
}

describe("fallback routes", () => {
  test("a repeated fallback name is attempted once", async () => {
    const attempts: string[] = [];

    const client = createEmailClient({
      adapters: [rejecting("primary", attempts), rejecting("backup", attempts)],
      telemetry: false,
    });

    const error = await client
      .send(message, { fallback: { adapters: ["backup", "backup", "primary", "backup"] } })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(EmailRouteError);
    expect(attempts).toEqual(["primary", "backup"]);
  });
});

describe("sendMany item options", () => {
  test("an item retry merges with the batch retry instead of replacing it", async () => {
    let calls = 0;

    const flaky = adapter("flaky", () => {
      calls += 1;

      throw new EmailAdapterError("try again", { adapter: "flaky", retryable: true });
    });

    const client = createEmailClient({ adapters: [flaky], telemetry: false });

    await client.sendMany([{ message, options: { retry: { delay: () => 0 } } }], {
      retry: { maxAttempts: 3 },
    });

    // Before, the item's { delay } replaced { maxAttempts: 3 } and the send ran once.
    expect(calls).toBe(3);
  });

  test("an item fallback keeps the batch onUnknownDelivery but replaces its adapter list", async () => {
    const attempts: string[] = [];

    const unknown = adapter("unknown", () => {
      attempts.push("unknown");

      throw new EmailAdapterError("timeout", { adapter: "unknown", delivery: "unknown" });
    });

    const backup: EmailAdapter<"backup"> = adapter("backup", () => {
      attempts.push("backup");

      return { adapter: "backup", id: "b_1" };
    });

    const spare = adapter("spare", () => {
      attempts.push("spare");

      return { adapter: "spare", id: "s_1" };
    });

    const client = createEmailClient({ adapters: [unknown, backup, spare], telemetry: false });

    const [result] = await client.sendMany(
      [{ message, options: { fallback: { adapters: ["spare"] } } }],
      { fallback: { adapters: ["backup"], onUnknownDelivery: "continue" } },
    );

    expect(result?.ok).toBe(true);
    expect(attempts).toEqual(["unknown", "spare"]);
  });
});

describe("sendMany explicit undefined item options", () => {
  test("an item's adapter: undefined clears the batch adapter", async () => {
    const used: string[] = [];

    const primary = adapter("primary", () => {
      used.push("primary");

      return { adapter: "primary", id: "p_1" };
    });

    const batch = adapter("batch", () => {
      used.push("batch");

      return { adapter: "batch", id: "b_1" };
    });

    const client = createEmailClient({ adapters: [primary, batch], telemetry: false });

    await client.sendMany(
      [{ message, options: { adapter: undefined } }, { message }],
      { adapter: "batch" },
    );

    // The first item clears the batch adapter and uses the client default, as a plain spread did.
    expect(used).toEqual(["primary", "batch"]);
  });

  test("an item's retry: undefined clears the batch retry", async () => {
    let calls = 0;

    const flaky = adapter("flaky", () => {
      calls += 1;

      throw new EmailAdapterError("try again", { adapter: "flaky", retryable: true });
    });

    const client = createEmailClient({ adapters: [flaky], telemetry: false });

    await client.sendMany([{ message, options: { retry: undefined } }], {
      retry: { maxAttempts: 3, delay: () => 0 },
    });

    expect(calls).toBe(1);
  });
});

describe("client.adapters", () => {
  test("is read-only at runtime, not only in its type", () => {
    const client = createEmailClient({ adapters: [adapter("primary")], telemetry: false });
    const view: object = client.adapters;

    expect("set" in view).toBe(false);
    expect("delete" in view).toBe(false);
    expect("clear" in view).toBe(false);
    expect(Object.prototype.toString.call(view)).toBe("[object ReadonlyMap]");
  });

  test("still reads like a Map and reflects adapters a client extension adds later", () => {
    const client = createEmailClient({
      adapters: [adapter("primary")],
      plugins: [
        {
          id: "late",
          extendClient(context) {
            context.addAdapter(adapter("late"));

            return {};
          },
        },
      ],
      telemetry: false,
    });

    expect(client.adapters.size).toBe(2);
    expect([...client.adapters.keys()]).toEqual(["primary", "late"]);
    expect(client.adapters.get("primary")?.name).toBe("primary");
    expect(client.adapters.has("missing")).toBe(false);
    expect(new Map(client.adapters).size).toBe(2);
  });

  test("plugin contexts get the same read-only view", () => {
    let contextAdapters: object | undefined;

    createEmailClient({
      adapters: [adapter("primary")],
      plugins: [
        {
          id: "inspect",
          adapters(context) {
            contextAdapters = context.adapters;

            return [];
          },
        },
      ],
      telemetry: false,
    });

    expect(contextAdapters && "set" in contextAdapters).toBe(false);
  });
});
