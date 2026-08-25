import { describe, expect, test } from "bun:test";

import { ConvexEmail } from "./index.js";

const message = {
  from: "Acme <hello@example.com>",
  to: "ada@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
};

function createEmail() {
  return new ConvexEmail({
    lib: {
      enqueue: {},
      enqueueOwned: {},
      enqueueBatch: {},
      status: {},
      listEvents: {},
      cancel: {},
      retry: {},
      setConfig: {},
      getConfig: {},
    },
    worker: { handleWebhook: {} },
  });
}

function handler<T>(definition: unknown) {
  return (definition as { _handler: T })._handler;
}

describe("ConvexEmail.exposeApi", () => {
  test("rejects an unauthenticated send before queueing", async () => {
    const api = createEmail().exposeApi();
    const send = handler<(ctx: unknown, args: typeof message) => Promise<string>>(api.send);
    const runMutation = async () => {
      throw new Error("queue must not be called");
    };

    await expect(
      send({ auth: { getUserIdentity: async () => null }, runMutation }, message),
    ).rejects.toThrow("Unauthorized");
  });

  test("stamps the authenticated subject as the server-controlled email owner", async () => {
    const api = createEmail().exposeApi();
    const send = handler<(ctx: unknown, args: typeof message) => Promise<string>>(api.send);
    let queuedArgs: unknown;

    const emailId = await send(
      {
        auth: { getUserIdentity: async () => ({ subject: "user_123" }) },
        runMutation: async (_reference: unknown, args: unknown) => {
          queuedArgs = args;
          return "email_123";
        },
      },
      message,
    );

    expect(emailId).toBe("email_123");
    expect(queuedArgs).toMatchObject({ email: message, ownerId: "user_123" });
  });

  test("hides emails and events from a different authenticated owner", async () => {
    const api = createEmail().exposeApi();
    const status = handler<(ctx: unknown, args: { emailId: string }) => Promise<unknown>>(api.status);
    const listEvents = handler<(ctx: unknown, args: { emailId: string }) => Promise<unknown>>(api.listEvents);
    let queryCalls = 0;
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: "user_456" }) },
      runQuery: async () => {
        queryCalls += 1;
        return { _id: "email_123", ownerId: "user_123" };
      },
    };

    expect(await status(ctx, { emailId: "email_123" })).toBeNull();
    queryCalls = 0;
    expect(await listEvents(ctx, { emailId: "email_123" })).toEqual([]);
    expect(queryCalls).toBe(1);
  });

  test("requires an explicit admin authorizer before exposing configuration", () => {
    expect(() => createEmail().exposeApi({ includeConfigApi: true })).toThrow("authorizeConfig");
  });
});
