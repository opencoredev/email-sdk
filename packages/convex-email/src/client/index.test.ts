import { describe, expect, test } from "bun:test";

import { ConvexEmail, type ConvexEmailPublicAuthorizer } from "./index.js";

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
      enqueueOwnedBatch: {},
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

  test("queues public batches through one owner-stamped component mutation", async () => {
    const api = createEmail().exposeApi();
    const sendBatch = handler<(ctx: unknown, args: { messages: typeof message[] }) => Promise<string[]>>(
      api.sendBatch,
    );
    let mutationCalls = 0;
    let queuedArgs: unknown;

    const ids = await sendBatch(
      {
        auth: { getUserIdentity: async () => ({ subject: "user_123", tokenIdentifier: "app|user_123" }) },
        runMutation: async (_reference: unknown, args: unknown) => {
          mutationCalls += 1;
          queuedArgs = args;
          return ["email_1", "email_2"];
        },
      },
      { messages: [message, { ...message, to: "grace@example.com" }] },
    );

    expect(ids).toEqual(["email_1", "email_2"]);
    expect(mutationCalls).toBe(1);
    expect(queuedArgs).toMatchObject({
      ownerId: "user_123",
      messages: [
        { ...message, adapter: undefined, adapters: undefined, fallbackAdapters: undefined },
        {
          ...message,
          to: "grace@example.com",
          adapter: undefined,
          adapters: undefined,
          fallbackAdapters: undefined,
        },
      ],
    });
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

  test("exposes the Convex token identifier to custom authorizers", async () => {
    const authorize: ConvexEmailPublicAuthorizer = async (ctx) => {
      const identity = await ctx.auth.getUserIdentity();
      return identity?.tokenIdentifier.startsWith("app|") ? identity.subject : null;
    };

    expect(await authorize({ auth: { getUserIdentity: async () => ({ subject: "user_123", tokenIdentifier: "app|user_123" }) } }, "send")).toBe("user_123");
  });
});
